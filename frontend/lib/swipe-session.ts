/**
 * Swipeable rows on /trips (one ranked list, no separate deck): the undo history, the last toast and
 * the trips being swiped away, kept outside the components (not persisted). A ranking update (the
 * full phase landing) re-renders the list but never drops the toast or the history (#49), so undo
 * always reaches the right trip. The session ends when the user leaves /trips (reset()).
 */
import { create } from "zustand";
import type { SwipeEntry } from "./use-reactions";

/** How long a toast stays on screen (long enough to read, to hit "Undo", and for a slow test step). */
export const TOAST_MS = 6000;

export interface SwipeToast {
  text: string;
  /** distinguishes two identical texts in a row, so each one is shown and timed */
  id: number;
  /** the toast offers "Undo" for the last swipe */
  undoable: boolean;
}

interface SwipeSession {
  history: SwipeEntry[];
  toast: SwipeToast | null;
  /** swiped left, collapsing out while the backend confirms (the list leaves them out right away) */
  hiding: string[];
  remember: (e: SwipeEntry) => void;
  forget: (e: SwipeEntry) => void;
  hide: (id: string) => void;
  unhide: (id: string) => void;
  showToast: (text: string, undoable?: boolean) => void;
  /** Clears the toast only if it is still the one that timed out. */
  clearToast: (id: number) => void;
  reset: () => void;
}

let nextId = 1;

export const useSwipeSession = create<SwipeSession>()((set) => ({
  history: [],
  toast: null,
  hiding: [],
  remember: (e) => set((s) => ({ history: [...s.history, e] })),
  forget: (e) => set((s) => ({ history: s.history.filter((x) => x !== e) })),
  hide: (id) => set((s) => ({ hiding: s.hiding.includes(id) ? s.hiding : [...s.hiding, id] })),
  unhide: (id) => set((s) => ({ hiding: s.hiding.filter((x) => x !== id) })),
  showToast: (text, undoable = false) => set({ toast: { text, id: nextId++, undoable } }),
  clearToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : {})),
  reset: () => set({ history: [], toast: null, hiding: [] }),
}));

/** A horizontal drag commits past this distance (px) or this speed (px/s); anything less springs back. */
export const SWIPE_COMMIT_PX = 96;
export const SWIPE_COMMIT_VELOCITY = 600;

/** What a released horizontal drag means. Vertical scrolling never reaches here (pan-y + direction lock). */
export function swipeIntent(offsetX: number, velocityX: number): "like" | "dislike" | null {
  if (offsetX >= SWIPE_COMMIT_PX || (offsetX > 24 && velocityX >= SWIPE_COMMIT_VELOCITY)) return "like";
  if (offsetX <= -SWIPE_COMMIT_PX || (offsetX < -24 && velocityX <= -SWIPE_COMMIT_VELOCITY)) return "dislike";
  return null;
}
