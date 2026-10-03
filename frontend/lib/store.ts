"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DataMode } from "./api";
import { weightsFromSlider } from "./scoring";
import type { ChatMessage, FreeWindow, Recommendation, TasteProfile, Weights } from "./types";

export interface FeedbackDiff {
  tripId: string;
  before: { weights: Weights; profile: TasteProfile; ranking: string[] };
  after: { weights: Weights; profile: TasteProfile; ranking: string[] };
}

interface TripState {
  messages: ChatMessage[];
  profile: TasteProfile | null;
  windows: FreeWindow[];
  recs: Recommendation[];
  /** Slider position 0..100 (price -> comfort -> experience). null = custom weights from feedback. */
  slider: number | null;
  weights: Weights;
  mode: DataMode | null;
  approved: string[];
  feedback: FeedbackDiff | null;

  setMessages: (m: ChatMessage[]) => void;
  setProfile: (p: TasteProfile | null) => void;
  setWindows: (w: FreeWindow[]) => void;
  setRecs: (r: Recommendation[]) => void;
  setSlider: (pos: number) => void;
  setWeights: (w: Weights) => void;
  setMode: (m: DataMode) => void;
  approve: (id: string) => void;
  setFeedback: (f: FeedbackDiff | null) => void;
  reset: () => void;
}

const initial = {
  messages: [],
  profile: null,
  windows: [],
  recs: [],
  slider: 50,
  weights: weightsFromSlider(50),
  mode: null,
  approved: [],
  feedback: null,
};

export const useTrip = create<TripState>()(
  persist(
    (set) => ({
      ...initial,
      setMessages: (messages) => set({ messages }),
      setProfile: (profile) => set({ profile }),
      setWindows: (windows) => set({ windows }),
      setRecs: (recs) => set({ recs }),
      setSlider: (slider) => set({ slider, weights: weightsFromSlider(slider) }),
      setWeights: (weights) => set({ weights, slider: null }),
      setMode: (mode) => set({ mode }),
      approve: (id) => set((s) => ({ approved: s.approved.includes(id) ? s.approved : [...s.approved, id] })),
      setFeedback: (feedback) => set({ feedback }),
      reset: () => set({ ...initial }),
    }),
    { name: "tripai-v1", storage: createJSONStorage(() => localStorage) },
  ),
);

/** True once zustand has rehydrated from localStorage (avoids SSR flashes). */
export function useHydrated() {
  return useSyncExternalStore(
    (cb) => useTrip.persist.onFinishHydration(cb),
    () => useTrip.persist.hasHydrated(),
    () => false,
  );
}
