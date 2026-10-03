import { describe, expect, it, vi } from "vitest";

// Node's localStorage stub has no setItem; the persisted store needs a real one before import.
vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
    configurable: true,
  });
});
import { useSwipe } from "./use-reactions";

const merge = useSwipe.persist.getOptions().merge!;

describe("/trips opens on the swipe view until the user picks one", () => {
  it("a first visit starts on swipe ('Karty')", () => {
    expect(useSwipe.getInitialState().view).toBe("swipe");
  });
  it("a picked view is remembered", () => {
    useSwipe.getState().setView("list");
    expect(useSwipe.getState()).toMatchObject({ view: "list", viewChosen: true });
    const back = merge({ view: "list", viewChosen: true }, useSwipe.getInitialState());
    expect(back).toMatchObject({ view: "list", viewChosen: true });
  });
  it("state saved before the choice existed (old default 'list') opens on swipe", () => {
    expect(merge({ view: "list", log: [] }, useSwipe.getInitialState())).toMatchObject({ view: "swipe", viewChosen: false });
  });
});
