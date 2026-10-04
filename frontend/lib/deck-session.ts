/**
 * The open swipe deck on /trips, kept outside the component (not persisted): the card snapshot, the
 * position, the undo history and the last "Learned: …" / "Undone" toast. A ranking update (the full
 * phase landing, a refetch that briefly empties the list) can re-render or even remount the deck;
 * none of that may drop the toast or the history, so undo still restores the same card.
 * The session ends when the user leaves the swipe view or /trips (reset()).
 */
import { create } from "zustand";
import type { RankedRecommendation } from "./types";
import type { SwipeEntry } from "./use-reactions";

/** How long a toast stays on screen (long enough to read, and for a test to see after a slow step). */
export const TOAST_MS = 6000;

export interface DeckToast {
  text: string;
  /** distinguishes two identical texts in a row, so each one is shown and timed */
  id: number;
}

interface DeckSession {
  cards: RankedRecommendation[] | null;
  position: number;
  history: SwipeEntry[];
  toast: DeckToast | null;
  /** Take the deck snapshot once the ranking is final; later rankings never reshuffle it. */
  offer: (ranked: RankedRecommendation[], refining: boolean, seen: Set<string>) => void;
  advance: () => void;
  back: () => void;
  pushBack: (rec: RankedRecommendation) => void;
  remember: (e: SwipeEntry) => void;
  forget: (e: SwipeEntry) => void;
  showToast: (text: string) => void;
  /** Clears the toast only if it is still the one that timed out. */
  clearToast: (id: number) => void;
  reset: () => void;
}

let nextId = 1;

export const useDeckSession = create<DeckSession>()((set, get) => ({
  cards: null,
  position: 0,
  history: [],
  toast: null,
  offer: (ranked, refining, seen) => {
    if (get().cards || refining || !ranked.length) return;
    set({ cards: ranked.filter((r) => !seen.has(r.id)) });
  },
  advance: () => set((s) => ({ position: s.position + 1 })),
  back: () => set((s) => ({ position: Math.max(0, s.position - 1) })),
  pushBack: (rec) => set((s) => ({ cards: s.cards ? [...s.cards, rec] : s.cards })),
  remember: (e) => set((s) => ({ history: [...s.history, e] })),
  forget: (e) => set((s) => ({ history: s.history.filter((x) => x !== e) })),
  showToast: (text) => set({ toast: { text, id: nextId++ } }),
  clearToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : {})),
  reset: () => set({ cards: null, position: 0, history: [], toast: null }),
}));
