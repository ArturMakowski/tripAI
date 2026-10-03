"use client";

/**
 * T6 swipe on offers: client for POST/DELETE /reactions (+ T5b /picks for "Chcę tam"), and the
 * swipe log. Learning is buffered while the deck is open (`pending`) and committed to the trip
 * store when you go back to the list, so the ranking refetches once (not after every swipe:
 * live /recommendations costs real API calls).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { API_URL, FORCE_MOCK, HttpError, SESSION_HEADER, readSession, rememberSession } from "./api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { applyReaction, undoReaction, type Reaction, type ReactionResponse, type ReactionUndo } from "./reactions";
import { normalise } from "./scoring";
import { useTrip } from "./store";
import type { RankedRecommendation, TasteProfile, Weights } from "./types";

export type TripsView = "list" | "swipe";
export type WatchStatus = "ok" | "full" | "demo" | null;

export interface SwipeEntry {
  rec: RankedRecommendation;
  reaction: Reaction;
  res: ReactionResponse;
  /** answered by the in-browser mirror (fixture mode, or the backend didn't know this card) */
  local: boolean;
  undo: ReactionUndo | null;
  watch: WatchStatus;
  at: number;
}

interface SwipeState {
  view: TripsView;
  log: SwipeEntry[];
  /** learned profile/weights not yet pushed into the trip store (deck open) */
  pending: { profile: TasteProfile; weights: Weights; weightsChanged: boolean } | null;
  setView: (v: TripsView) => void;
  push: (e: SwipeEntry, learned: { profile: TasteProfile; weights: Weights }) => void;
  drop: (recId: string, learned: { profile: TasteProfile; weights: Weights }) => void;
  clearPending: () => void;
  reset: () => void;
}

export const useSwipe = create<SwipeState>()(
  persist(
    (set) => ({
      view: "list",
      log: [],
      pending: null,
      setView: (view) => set({ view }),
      push: (e, learned) =>
        set((s) => ({
          log: [...s.log.filter((x) => x.rec.id !== e.rec.id), e],
          pending: { ...learned, weightsChanged: !!s.pending?.weightsChanged || e.res.diff.some((c) => c.field.startsWith("weights.")) },
        })),
      drop: (recId, learned) =>
        set((s) => ({ log: s.log.filter((x) => x.rec.id !== recId), pending: { ...learned, weightsChanged: true } })),
      clearPending: () => set({ pending: null }),
      reset: () => set({ view: "list", log: [], pending: null }),
    }),
    // the log keeps whole cards so "hidden" can show them; cap it so localStorage stays small
    { name: "tripai-swipe-v1", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ ...s, log: s.log.slice(-60) }) },
  ),
);

/** Ids of city+dates you swiped "Nie dla mnie" (hidden from the list, shown under "Hidden"). */
export function hiddenIds(log: SwipeEntry[]): Set<string> {
  return new Set(log.filter((e) => e.reaction === "dislike").map((e) => e.rec.id));
}

// --- HTTP -------------------------------------------------------------------------------

async function http<T>(path: string, init: RequestInit): Promise<T> {
  const token = readSession();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { [SESSION_HEADER]: token } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  rememberSession(res);
  if (!res.ok) throw new HttpError(res.status, `${init.method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** The profile/weights the next swipe builds on: the deck's pending learning, else the store's. */
export function currentBase(): { profile: TasteProfile; weights: Weights } {
  const p = useSwipe.getState().pending;
  if (p) return { profile: p.profile, weights: p.weights };
  const t = useTrip.getState();
  return { profile: t.profile ?? DEMO_PROFILE, weights: t.weights };
}

async function watch(rec: RankedRecommendation, local: boolean): Promise<WatchStatus> {
  if (FORCE_MOCK || local) return "demo";
  try {
    await http("/picks", { method: "POST", body: JSON.stringify({ recommendation_id: rec.id }) });
    return "ok";
  } catch (err) {
    return err instanceof HttpError && err.status === 409 ? "full" : null;
  }
}

/** One swipe: backend first (session user, never a client user_id); the mirror only as fallback. */
export async function react(rec: RankedRecommendation, reaction: Reaction): Promise<SwipeEntry> {
  const { profile, weights } = currentBase();
  const local = () => {
    const { undo, ...res } = applyReaction(profile, weights, rec, reaction);
    return { res, undo };
  };
  let res: ReactionResponse;
  let undo: ReactionUndo | null = null;
  let isLocal = FORCE_MOCK;
  if (FORCE_MOCK) ({ res, undo } = local());
  else {
    try {
      res = await http<ReactionResponse>("/reactions", {
        method: "POST",
        body: JSON.stringify({ recommendation_id: rec.id, reaction, profile, weights }),
      });
    } catch (err) {
      // 404 = the backend never stored this card (e.g. a fast-phase list); unreachable = demo mode
      console.warn("[tripai] /reactions unavailable, learning in the browser:", err);
      ({ res, undo } = local());
      isLocal = true;
    }
  }
  const entry: SwipeEntry = {
    rec,
    reaction,
    res,
    local: isLocal,
    undo,
    watch: reaction === "dislike" ? null : await watch(rec, isLocal),
    at: Date.now(),
  };
  useSwipe.getState().push(entry, { profile: res.profile, weights: res.weights });
  return entry;
}

/** Undo a swipe: revert what it changed, unhide, unwatch. */
export async function unreact(entry: SwipeEntry): Promise<ReactionResponse> {
  const { profile, weights } = currentBase();
  let res: ReactionResponse;
  if (entry.local || FORCE_MOCK) {
    res = entry.undo
      ? undoReaction(profile, weights, entry.rec, entry.undo)
      : { ...entry.res, reaction: null, hidden: false, diff: [], learned: [], profile, weights };
  } else {
    try {
      res = await http<ReactionResponse>(`/reactions/${encodeURIComponent(entry.rec.id)}`, {
        method: "DELETE",
        body: JSON.stringify(profile),
      });
    } catch (err) {
      console.warn("[tripai] undo failed on the backend:", err);
      res = { ...entry.res, reaction: null, hidden: false, diff: [], learned: [], profile, weights };
    }
  }
  if (entry.watch === "ok") http(`/picks/${encodeURIComponent(entry.rec.id)}`, { method: "DELETE" }).catch(() => {});
  useSwipe.getState().drop(entry.rec.id, { profile: res.profile, weights: res.weights });
  return res;
}

/**
 * Push the learned profile (and weights, if a swipe moved one) into the trip store. A new profile
 * invalidates the cached ranking, so /recommendations runs once with it.
 */
export function commitLearning() {
  const { pending, clearPending } = useSwipe.getState();
  if (!pending) return;
  const trip = useTrip.getState();
  const same = JSON.stringify(trip.profile ?? DEMO_PROFILE) === JSON.stringify(pending.profile);
  if (pending.weightsChanged) {
    const a = normalise(trip.weights);
    const b = normalise(pending.weights);
    if ((["price", "weather", "crowds", "taste"] as const).some((f) => Math.abs(a[f] - b[f]) >= 0.005)) trip.setWeights(pending.weights);
  }
  if (!same) trip.setProfile(pending.profile);
  clearPending();
}
