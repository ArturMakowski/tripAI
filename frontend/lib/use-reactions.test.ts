import { beforeEach, describe, expect, it, vi } from "vitest";

// Node's own global localStorage is a stub without a backing file: give the persisted stores a real one.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
});
import { buildRecommendations, DEMO_PROFILE } from "./mock/fixtures";
import { useTrip } from "./store";
import { commitLearning, hiddenIds, react, unreact, useSwipe } from "./use-reactions";

// NEXT_PUBLIC_MOCK=1 in tests (vitest.config.mts): every call is answered by the in-browser mirror (fixture mode).
const recs = buildRecommendations();

describe("swipe flow (fixture mode)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useSwipe.getState().reset();
    useTrip.getState().reset();
    useTrip.getState().setProfile(DEMO_PROFILE);
  });

  it("buffers learning while swiping and commits it once, re-ranking with the new profile", async () => {
    const [a, b] = recs;
    const liked = await react(a, "like");
    expect(liked.watch).toBe("demo"); // price alerts need the live API
    await react(b, "dislike");
    const s = useSwipe.getState();
    expect(s.log.map((e) => e.reaction)).toEqual(["like", "dislike"]);
    expect(hiddenIds(s.log)).toEqual(new Set([b.id]));
    // second swipe built on the first one's profile
    expect(s.pending?.profile.interests).not.toEqual(DEMO_PROFILE.interests);
    useTrip.getState().setRecs(recs, { profile: DEMO_PROFILE, weights: useTrip.getState().weights, mode: "fixture" });
    expect(useTrip.getState().profile).toEqual(DEMO_PROFILE); // nothing applied mid-deck
    commitLearning();
    expect(useTrip.getState().profile?.interests).toEqual(s.pending?.profile.interests);
    expect(useTrip.getState().recs).toEqual([]); // cached ranking invalidated -> one refetch
    expect(useSwipe.getState().pending).toBeNull();
  });

  it("undo reverts the profile and unhides the trip", async () => {
    const [a] = recs;
    const entry = await react(a, "dislike");
    await unreact(entry);
    expect(useSwipe.getState().log).toEqual([]);
    commitLearning();
    expect(useTrip.getState().profile?.interests).toEqual(DEMO_PROFILE.interests);
  });
});
