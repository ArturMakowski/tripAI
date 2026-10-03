"use client";

/**
 * T6 swipe on offers: client for POST/DELETE /reactions (+ T5b /picks for "Chcę tam"), and the
 * swipe log. Learning is buffered while the deck is open (`pending`) and committed to the trip
 * store when you go back to the list, so the ranking refetches once (not after every swipe:
 * live /recommendations costs real API calls).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { API_URL, FORCE_MOCK, HttpError, SESSION_HEADER, readSession, rememberSession, getApiLang } from "./api";
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
  /** what to revert if the backend can't (local entries, or a 404 on undo) */
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
    { name: "tripai-swipe-v1", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ ...s, log: capLog(s.log) }) },
  ),
);

/** Keep every dislike (it hides a trip until restored) and the last 60 other swipes. */
export function capLog(log: SwipeEntry[]): SwipeEntry[] {
  const keep = new Set(log.filter((e) => e.reaction !== "dislike").slice(-60));
  return log.filter((e) => e.reaction === "dislike" || keep.has(e));
}

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

/** Undo snapshot for a backend answer, taken from its diff (the same fields the server keeps). */
export function snapshotFromDiff(res: ReactionResponse, weightsBefore: Weights): ReactionUndo {
  const interestsBefore: Record<string, number | null> = {};
  for (const c of res.diff)
    if (c.field.startsWith("interests.")) interestsBefore[c.field.slice("interests.".length)] = (c.before as number | null) ?? null;
  return { interestsBefore, diff: res.diff, weightsBefore: normalise(weightsBefore), weightsAfter: res.weights };
}

/**
 * One swipe: backend first (session user, never a client user_id). The in-browser mirror answers
 * only when the server provably stored nothing: fixture mode, or 404 (it doesn't know this card).
 * Any other failure (timeout, 5xx, network) throws: the server may have committed, so we must not
 * pretend it was local (a later local undo would never reach the server).
 */
export async function react(rec: RankedRecommendation, reaction: Reaction): Promise<SwipeEntry> {
  const { profile, weights } = currentBase();
  const lang = getApiLang(); // the app-wide UI language (lib/i18n via LangSync)
  const local = () => {
    const { undo, ...res } = applyReaction(profile, weights, rec, reaction, lang);
    return { res, undo };
  };
  let res: ReactionResponse;
  let undo: ReactionUndo;
  let isLocal = FORCE_MOCK || useTrip.getState().modes.recs === "fixture";
  if (isLocal) ({ res, undo } = local());
  else {
    try {
      res = await http<ReactionResponse>("/reactions", {
        method: "POST",
        body: JSON.stringify({ recommendation_id: rec.id, reaction, profile, weights, lang }),
      });
      undo = snapshotFromDiff(res, weights);
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      console.warn("[tripai] backend doesn't know this card, learning in the browser:", err.message);
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

/**
 * Undo a swipe: revert what it changed, unhide, unwatch. Throws (and keeps the entry) when the
 * backend couldn't undo it, so the UI never says "undone" when nothing was. A 404 means the server
 * has no such reaction (e.g. a new session after a redeploy): the learning then only lives here,
 * so it is reverted locally from the snapshot.
 */
export async function unreact(entry: SwipeEntry): Promise<ReactionResponse> {
  const { profile, weights } = currentBase();
  const lang = getApiLang(); // the app-wide UI language (lib/i18n via LangSync)
  const local = (): ReactionResponse =>
    entry.undo
      ? undoReaction(profile, weights, entry.rec, entry.undo, lang)
      : { ...entry.res, reaction: null, hidden: false, diff: [], learned: [], profile, weights };
  let res: ReactionResponse;
  if (entry.local || FORCE_MOCK) res = local();
  else {
    try {
      res = await http<ReactionResponse>(`/reactions/${encodeURIComponent(entry.rec.id)}?lang=${lang}`, {
        method: "DELETE",
        body: JSON.stringify(profile),
      });
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      res = local();
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
