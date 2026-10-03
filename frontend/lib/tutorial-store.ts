"use client";

/**
 * First-run tutorial state (T11): which parts a user has already seen on this device.
 *
 * Flags live in localStorage under one versioned key. Storage can be missing or throw
 * (Safari private mode, blocked site data, SSR), so every access is guarded and falls back
 * to memory: the tutorial then shows once per page load instead of crashing.
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";

export const TUTORIAL_KEY = "tripai-tutorial-v1";

/** Screens with contextual coach marks. */
export type TourKey = "trips" | "receipt" | "windows" | "inbox";
export const TOUR_KEYS: TourKey[] = ["trips", "receipt", "windows", "inbox"];

export interface TutorialFlags {
  intro: boolean;
  tours: Partial<Record<TourKey, true>>;
}

export const EMPTY_FLAGS: TutorialFlags = { intro: false, tours: {} };

type KV = Pick<Storage, "getItem" | "setItem">;

/** localStorage if it is usable (exists, reads and writes), else null. */
export function safeStorage(): KV | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = `${TUTORIAL_KEY}-probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Parse stored flags; anything malformed reads as "nothing seen yet". */
export function loadFlags(storage: KV | null): TutorialFlags {
  try {
    const raw = storage?.getItem(TUTORIAL_KEY);
    if (!raw) return EMPTY_FLAGS;
    const data = JSON.parse(raw) as Partial<TutorialFlags>;
    const tours: TutorialFlags["tours"] = {};
    for (const k of TOUR_KEYS) if (data.tours?.[k] === true) tours[k] = true;
    return { intro: data.intro === true, tours };
  } catch {
    return EMPTY_FLAGS;
  }
}

/** Returns false when the flags could not be written (memory-only for this session). */
export function saveFlags(storage: KV | null, flags: TutorialFlags): boolean {
  try {
    if (!storage) return false;
    storage.setItem(TUTORIAL_KEY, JSON.stringify(flags));
    return true;
  } catch {
    return false;
  }
}

/** Which coach-mark tour belongs to a route (`/trips/<id>` is the receipt, its `/confirm` has none). */
export function tourForPath(path: string): TourKey | null {
  if (path === "/trips") return "trips";
  if (/^\/trips\/[^/]+$/.test(path)) return "receipt";
  if (path === "/windows") return "windows";
  if (path === "/inbox") return "inbox";
  return null;
}

/** Routes where the intro never opens on its own (attribution page, push-notification landing). */
const NO_AUTO_INTRO = ["/credits", "/inbox/open"];

export function shouldAutoOpenIntro(flags: TutorialFlags, path: string): boolean {
  return !flags.intro && !NO_AUTO_INTRO.includes(path);
}

/** Step navigation for the intro carousel, clamped to [0, count - 1]. */
export function stepTo(target: number, count: number): number {
  return Math.min(Math.max(target, 0), Math.max(count - 1, 0));
}

interface TutorialState {
  hydrated: boolean;
  flags: TutorialFlags;
  introOpen: boolean;
  hydrate: () => void;
  openIntro: () => void;
  /** Closes the intro and remembers it (finished or skipped: both count as seen). */
  closeIntro: () => void;
  markTourSeen: (k: TourKey) => void;
  /** "How it works": forget everything and show the intro again; coach marks return on next visit. */
  replay: () => void;
}

export const useTutorial = create<TutorialState>()((set, get) => {
  const persist = (flags: TutorialFlags) => {
    saveFlags(safeStorage(), flags);
    set({ flags });
  };
  return {
    hydrated: false,
    flags: EMPTY_FLAGS,
    introOpen: false,
    hydrate: () => {
      if (get().hydrated) return;
      set({ hydrated: true, flags: loadFlags(safeStorage()) });
    },
    openIntro: () => set({ introOpen: true }),
    closeIntro: () => {
      set({ introOpen: false });
      persist({ ...get().flags, intro: true });
    },
    markTourSeen: (k) => persist({ ...get().flags, tours: { ...get().flags.tours, [k]: true } }),
    replay: () => {
      persist(EMPTY_FLAGS);
      set({ introOpen: true });
    },
  };
});

const noop = () => () => {};

/** True after mount: tutorial UI renders client-only, so prerendered pages never mismatch. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
