import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTRO_STEPS, TOURS, TUTORIAL_COPY } from "@/components/tutorial/strings";
import {
  EMPTY_FLAGS,
  loadFlags,
  safeStorage,
  saveFlags,
  shouldAutoOpenIntro,
  stepTo,
  TOUR_KEYS,
  tourForPath,
  TUTORIAL_KEY,
  useTutorial,
} from "./tutorial-store";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("seen flags", () => {
  it("round-trips through storage", () => {
    const s = memoryStorage();
    expect(saveFlags(s, { intro: true, tours: { trips: true } })).toBe(true);
    expect(loadFlags(s)).toEqual({ intro: true, tours: { trips: true } });
  });

  it("reads missing, malformed or foreign data as nothing seen", () => {
    const s = memoryStorage();
    expect(loadFlags(s)).toEqual(EMPTY_FLAGS);
    s.setItem(TUTORIAL_KEY, "{not json");
    expect(loadFlags(s)).toEqual(EMPTY_FLAGS);
    s.setItem(TUTORIAL_KEY, JSON.stringify({ intro: "yes", tours: { trips: 1, receipt: true, bogus: true } }));
    expect(loadFlags(s)).toEqual({ intro: false, tours: { receipt: true } });
  });

  it("never throws when storage is missing or blocked", () => {
    expect(loadFlags(null)).toEqual(EMPTY_FLAGS);
    expect(loadFlags(throwing)).toEqual(EMPTY_FLAGS);
    expect(saveFlags(null, EMPTY_FLAGS)).toBe(false);
    expect(saveFlags(throwing, EMPTY_FLAGS)).toBe(false);
  });

  it("safeStorage is null outside the browser (SSR, vitest node)", () => {
    expect(safeStorage()).toBeNull();
  });
});

describe("routing", () => {
  it("maps routes to coach-mark tours", () => {
    expect(tourForPath("/trips")).toBe("trips");
    expect(tourForPath("/trips/rome-2027-01-14")).toBe("receipt");
    expect(tourForPath("/trips/rome-2027-01-14/confirm")).toBeNull();
    expect(tourForPath("/windows")).toBe("windows");
    expect(tourForPath("/inbox")).toBe("inbox");
    expect(tourForPath("/inbox/settings")).toBeNull();
    expect(tourForPath("/")).toBeNull();
  });

  it("opens the intro once, and never on credits or a push landing", () => {
    expect(shouldAutoOpenIntro(EMPTY_FLAGS, "/")).toBe(true);
    expect(shouldAutoOpenIntro(EMPTY_FLAGS, "/trips")).toBe(true);
    expect(shouldAutoOpenIntro(EMPTY_FLAGS, "/credits")).toBe(false);
    expect(shouldAutoOpenIntro(EMPTY_FLAGS, "/inbox/open")).toBe(false);
    expect(shouldAutoOpenIntro({ intro: true, tours: {} }, "/")).toBe(false);
  });
});

describe("intro step flow", () => {
  it("clamps navigation to the four steps", () => {
    const n = INTRO_STEPS.length;
    expect(n).toBe(4);
    expect(stepTo(1, n)).toBe(1);
    expect(stepTo(-1, n)).toBe(0);
    expect(stepTo(n, n)).toBe(n - 1);
    expect(stepTo(3, 0)).toBe(0);
  });
});

describe("store", () => {
  let mem: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    mem = memoryStorage();
    vi.stubGlobal("window", { localStorage: mem });
    useTutorial.setState({ hydrated: false, flags: EMPTY_FLAGS, introOpen: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hydrates from storage, remembers a closed intro and seen tours, and replay clears them", () => {
    mem.setItem(TUTORIAL_KEY, JSON.stringify({ intro: false, tours: { windows: true } }));
    const s = useTutorial.getState();
    s.hydrate();
    expect(useTutorial.getState().flags).toEqual({ intro: false, tours: { windows: true } });

    s.openIntro();
    expect(useTutorial.getState().introOpen).toBe(true);
    s.closeIntro();
    expect(useTutorial.getState().introOpen).toBe(false);
    s.markTourSeen("trips");
    expect(loadFlags(mem)).toEqual({ intro: true, tours: { windows: true, trips: true } });

    s.replay();
    expect(useTutorial.getState().introOpen).toBe(true);
    expect(loadFlags(mem)).toEqual(EMPTY_FLAGS);
  });

  it("keeps working in memory when storage throws", () => {
    vi.stubGlobal("window", { localStorage: throwing });
    const s = useTutorial.getState();
    s.hydrate();
    s.closeIntro();
    expect(useTutorial.getState().flags.intro).toBe(true);
  });
});

describe("copy", () => {
  it("has every intro step and coach mark in PL and EN", () => {
    for (const lang of ["pl", "en"] as const) {
      const t = TUTORIAL_COPY[lang];
      for (const id of INTRO_STEPS) expect(t.steps[id].title && t.steps[id].body).toBeTruthy();
      for (const k of TOUR_KEYS) for (const { anchor } of TOURS[k]) expect(t.coach.marks[anchor]?.title).toBeTruthy();
    }
    expect(TUTORIAL_COPY.pl.skip).toBe("Pomiń");
  });
});

describe("declutter budget (docs/DECLUTTER.md)", () => {
  const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
  it("keeps headlines ≤ 6 words and sublines / tips ≤ 10 words", () => {
    for (const lang of ["pl", "en"] as const) {
      const t = TUTORIAL_COPY[lang];
      for (const id of INTRO_STEPS) {
        expect(words(t.steps[id].title), t.steps[id].title).toBeLessThanOrEqual(6);
        expect(words(t.steps[id].body), t.steps[id].body).toBeLessThanOrEqual(10);
      }
      for (const m of Object.values(t.coach.marks)) {
        expect(words(m.title), m.title).toBeLessThanOrEqual(6);
        expect(words(m.body), m.body).toBeLessThanOrEqual(10);
      }
    }
  });
});
