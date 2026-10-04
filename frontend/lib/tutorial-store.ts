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

/**
 * The intro never opens on its own (T19, time to value): first run is welcome → 14 swipes → one confirm →
 * ranked trips, with contextual coach marks only (once per device). "How it works" in Profile still replays it.
 * Kept as a list so a path can opt back in.
 */
const AUTO_INTRO_PATHS: string[] = [];

export function shouldAutoOpenIntro(flags: TutorialFlags, path: string): boolean {
  return !flags.intro && AUTO_INTRO_PATHS.includes(path);
}

/** Cookie fallback for the flags (Safari private mode / blocked localStorage still keeps "seen"). */
const COOKIE = "tripai_tutorial";

export function readCookieFlags(cookie: string | null | undefined): TutorialFlags {
  try {
    const raw = (cookie ?? "").split("; ").find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return EMPTY_FLAGS;
    return loadFlags({ getItem: () => decodeURIComponent(raw.slice(COOKIE.length + 1)), setItem: () => {} });
  } catch {
    return EMPTY_FLAGS;
  }
}

function writeCookieFlags(flags: TutorialFlags) {
  try {
    if (typeof document === "undefined") return;
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(flags))}; max-age=31536000; path=/; samesite=lax`;
  } catch {
    // cookies blocked too: memory only for this session
  }
}

/** Anything seen in either store counts as seen (a cleared localStorage never brings the intro back). */
export function mergeFlags(a: TutorialFlags, b: TutorialFlags): TutorialFlags {
  return { intro: a.intro || b.intro, tours: { ...a.tours, ...b.tours } };
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
  /** The coach-mark tour running now ("trips:/trips"); it is marked seen as it starts. */
  runningTour: string | null;
  startTour: (k: TourKey, key: string) => void;
  /** "How it works": forget everything and show the intro again; coach marks return on next visit. */
  replay: () => void;
}

export const useTutorial = create<TutorialState>()((set, get) => {
  const persist = (flags: TutorialFlags) => {
    saveFlags(safeStorage(), flags);
    writeCookieFlags(flags);
    set({ flags });
  };
  return {
    hydrated: false,
    flags: EMPTY_FLAGS,
    introOpen: false,
    hydrate: () => {
      if (get().hydrated) return;
      const cookie = typeof document === "undefined" ? null : document.cookie;
      set({ hydrated: true, flags: mergeFlags(loadFlags(safeStorage()), readCookieFlags(cookie)) });
    },
    // Seen as soon as it is shown: a reload mid-intro, Skip, Esc or finishing never shows it again.
    openIntro: () => {
      set({ introOpen: true });
      persist({ ...get().flags, intro: true });
    },
    closeIntro: () => {
      set({ introOpen: false });
      persist({ ...get().flags, intro: true });
    },
    markTourSeen: (k) => persist({ ...get().flags, tours: { ...get().flags.tours, [k]: true } }),
    runningTour: null,
    startTour: (k, key) => {
      set({ runningTour: key });
      persist({ ...get().flags, tours: { ...get().flags.tours, [k]: true } });
    },
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
