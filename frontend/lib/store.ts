"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getApiLang, type DataMode } from "./api";
import type { DnaSwipe, Lang } from "./dna";
import { weightsFromSlider } from "./scoring";
import type { BridgeWindow, Change, DnaResponse, RecPhase, ChatMessage, FreeWindow, RankedRecommendation, TasteProfile, Weights } from "./types";

export interface FeedbackDiff {
  tripId: string;
  before: { weights: Weights; profile: TasteProfile; ranking: string[] };
  after: { weights: Weights; profile: TasteProfile; ranking: string[] };
  diff: Change[];
  /** Display info for every trip in either ranking (ids can differ between calls). */
  items: Record<string, { city: string; iata: string; window: FreeWindow; total_cost_pln: number }>;
  /** Travel DNA y2 = No: feedback was recorded but deliberately not applied. */
  frozen?: boolean;
}

/** Onboarding: dates + party + airports first ("trip"), then the DNA deck, then the result. */
export type DeckStep = "trip" | "swipe" | "result";

export type Dataset = "interview" | "windows" | "recs" | "feedback";

/** Cached data older than this is refetched (prices and calendars move). */
export const RECS_TTL_MS = 30 * 60_000;
export const WINDOWS_TTL_MS = 6 * 60 * 60_000;

interface TripState {
  messages: ChatMessage[];
  profile: TasteProfile | null;
  windows: FreeWindow[];
  longWeekends: BridgeWindow[];
  recs: RankedRecommendation[];
  /** When/for which profile+weights the cached recs were scored. */
  /** When / for which profile, weights and language the cached recs were fetched (AI text is language-specific). */
  recsMeta: { at: number; profileKey: string; weights: Weights; phase: RecPhase; lang: Lang } | null;
  windowsAt: number | null;
  /** Slider position 0..100 (price -> comfort -> experience). null = custom weights from feedback. */
  slider: number | null;
  weights: Weights;
  /** Which source answered each dataset; the badge shows "fixture" if any did. */
  modes: Partial<Record<Dataset, DataMode>>;
  approved: string[];
  feedback: FeedbackDiff | null;
  /** Swipe onboarding progress (survives a reload mid-deck). */
  deck: { swipes: DnaSwipe[]; step: DeckStep; airports: string[]; result: DnaResponse | null; /** "Ile osób?" chosen before the profile exists */ party?: number };
  /** UI + AI language for the whole app; null = follow the browser (see lib/i18n). */
  lang: Lang | null;
  setLang: (l: Lang) => void;

  setMessages: (m: ChatMessage[]) => void;
  setProfile: (p: TasteProfile | null) => void;
  setWindows: (w: FreeWindow[], lw: BridgeWindow[], mode: DataMode) => void;
  setRecs: (
    r: RankedRecommendation[],
    meta: { profile: TasteProfile | null; weights: Weights; mode: DataMode; merge?: boolean; phase?: RecPhase },
  ) => void;
  setSlider: (pos: number) => void;
  setWeights: (w: Weights) => void;
  setMode: (d: Dataset, m: DataMode) => void;
  approve: (id: string) => void;
  setFeedback: (f: FeedbackDiff | null) => void;
  setDeck: (patch: Partial<TripState["deck"]>) => void;
  reset: () => void;
}

const initial = {
  messages: [],
  profile: null,
  windows: [],
  longWeekends: [],
  recs: [],
  recsMeta: null,
  windowsAt: null,
  slider: 50,
  weights: weightsFromSlider(50),
  modes: {},
  approved: [],
  feedback: null,
  deck: { swipes: [] as DnaSwipe[], step: "trip" as DeckStep, airports: ["KRK"], result: null as DnaResponse | null },
  lang: null as Lang | null,
};

export const useTrip = create<TripState>()(
  persist(
    (set) => ({
      ...initial,
      setMessages: (messages) => set({ messages }),
      // A new or edited profile invalidates every cached ranking.
      setProfile: (profile) => set({ profile, recs: [], recsMeta: null }),
      setWindows: (windows, longWeekends, mode) =>
        set((s) => ({ windows, longWeekends, windowsAt: Date.now(), modes: { ...s.modes, windows: mode } })),
      setRecs: (recs, { profile, weights, mode, merge, phase = "full" }) =>
        set((s) => ({
          recs,
          // merged extras keep the list's phase (a fast list stays "refining")
          recsMeta: {
            at: Date.now(),
            profileKey: profileKey(profile),
            weights,
            phase: merge ? (s.recsMeta?.phase ?? phase) : phase,
            // the language this request went out in (LangSync keeps the API client in step with the UI)
            lang: getApiLang(),
          },
          // merging fixture recs into a live list downgrades the whole list
          modes: { ...s.modes, recs: merge && s.modes.recs === "fixture" ? "fixture" : mode },
        })),
      setSlider: (slider) => set({ slider, weights: weightsFromSlider(slider) }),
      setWeights: (weights) => set({ weights, slider: null }),
      setMode: (d, m) => set((s) => ({ modes: { ...s.modes, [d]: m } })),
      approve: (id) => set((s) => ({ approved: s.approved.includes(id) ? s.approved : [...s.approved, id] })),
      setFeedback: (feedback) => set({ feedback }),
      setDeck: (patch) => set((s) => ({ deck: { ...s.deck, ...patch } })),
      setLang: (lang) => set({ lang }),
      // keep the language across "start over"
      reset: () => set((s) => ({ ...initial, lang: s.lang })),
    }),
    { name: "tripai-v3", storage: createJSONStorage(() => localStorage) },
  ),
);

export function profileKey(p: TasteProfile | null): string {
  return p ? JSON.stringify(p) : "demo";
}

/** Combined badge state: any fixture-served dataset makes the screen "fixture". */
export function overallMode(modes: Partial<Record<Dataset, DataMode>>): DataMode | null {
  const vals = Object.values(modes);
  if (!vals.length) return null;
  return vals.includes("fixture") ? "fixture" : "live";
}

/** True once zustand has rehydrated from localStorage (avoids SSR flashes). */
export function useHydrated() {
  return useSyncExternalStore(
    (cb) => useTrip.persist.onFinishHydration(cb),
    () => useTrip.persist.hasHydrated(),
    () => false,
  );
}
