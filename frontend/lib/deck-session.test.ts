import { beforeEach, describe, expect, it } from "vitest";
import { useDeckSession } from "./deck-session";
import { buildRecommendations } from "./mock/fixtures";
import type { SwipeEntry } from "./use-reactions";

const ranked = buildRecommendations().map((r, i) => ({ ...r, rank: i + 1 }));
const entry = (i: number) => ({ rec: ranked[i], reaction: "like" }) as unknown as SwipeEntry;

describe("the swipe deck session survives a ranking update (#48: the full phase lands mid-swipe)", () => {
  beforeEach(() => useDeckSession.getState().reset());

  it("keeps the toast, the snapshot and the undo history when a new ranking arrives", () => {
    const s = () => useDeckSession.getState();
    s().offer(ranked, true, new Set()); // still refining: no snapshot yet
    expect(s().cards).toBeNull();
    s().offer(ranked, false, new Set());
    const snapshot = s().cards!.map((r) => r.id);

    // swipe the top card: position moves, the backend answers, the toast shows
    s().advance();
    s().remember(entry(0));
    s().showToast(`Learned: you like ${ranked[0].city}`);
    const toast = s().toast!;

    // the full phase lands: a re-ordered ranking with new prices (and the deck re-renders/remounts)
    const reordered = [...ranked].reverse().map((r) => ({ ...r, total_cost_pln: r.total_cost_pln + 7 }));
    s().offer(reordered, false, new Set());
    s().offer([], true, new Set()); // a refetch that briefly empties the list
    s().offer(reordered, false, new Set());

    expect(s().cards!.map((r) => r.id)).toEqual(snapshot); // never reshuffled under your thumb
    expect(s().toast).toBe(toast); // not overwritten or dropped
    expect(s().position).toBe(1);

    // undo restores the same card
    s().forget(entry(0));
    s().back();
    expect(s().cards![s().position].id).toBe(ranked[0].id);
  });

  it("a toast's timer only clears that toast; a newer one stays", () => {
    const s = () => useDeckSession.getState();
    s().showToast("Learned: you like Rome");
    const first = s().toast!.id;
    s().showToast("Undone: Rome");
    s().clearToast(first); // the first toast's timeout fires late
    expect(s().toast?.text).toBe("Undone: Rome");
    s().clearToast(s().toast!.id);
    expect(s().toast).toBeNull();
  });

  it("a session ends only on reset (leaving the swipe view or /trips)", () => {
    const s = () => useDeckSession.getState();
    s().offer(ranked, false, new Set([ranked[0].id]));
    expect(s().cards!.some((r) => r.id === ranked[0].id)).toBe(false); // already-swiped trips are left out
    s().showToast("x");
    s().reset();
    expect([s().cards, s().position, s().history.length, s().toast]).toEqual([null, 0, 0, null]);
  });
});
