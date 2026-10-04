import { beforeEach, describe, expect, it } from "vitest";
import { buildRecommendations } from "./mock/fixtures";
import { lockedSwipeIntent, shownRows, SWIPE_COMMIT_PX, SWIPE_COMMIT_VELOCITY, swipeIntent, useSwipeSession } from "./swipe-session";
import type { SwipeEntry } from "./use-reactions";

const recs = buildRecommendations();
const entry = (i: number, reaction: SwipeEntry["reaction"] = "like") => ({ rec: recs[i], reaction }) as unknown as SwipeEntry;
const s = () => useSwipeSession.getState();

describe("swipe intent: a clear horizontal drag past a threshold, nothing else", () => {
  it("commits right/left past the distance, or a short fast flick", () => {
    expect(swipeIntent(SWIPE_COMMIT_PX, 0)).toBe("like");
    expect(swipeIntent(-SWIPE_COMMIT_PX, 0)).toBe("dislike");
    expect(swipeIntent(40, SWIPE_COMMIT_VELOCITY)).toBe("like");
    expect(swipeIntent(-40, -SWIPE_COMMIT_VELOCITY)).toBe("dislike");
  });
  it("springs back on a small or slow drag, and a flick with no travel is a tap", () => {
    expect(swipeIntent(SWIPE_COMMIT_PX - 1, 100)).toBeNull();
    expect(swipeIntent(-50, -200)).toBeNull();
    expect(swipeIntent(8, 2000)).toBeNull();
  });
});

describe("the swipe session survives a ranking update", () => {
  beforeEach(() => s().reset());

  it("keeps the toast and the undo history; undo reaches the last swipe", () => {
    const nope = entry(1, "dislike");
    s().remember(entry(0));
    s().remember(nope);
    s().showToast(`Learned: ${recs[1].city} isn't for you`, true);
    const toast = s().toast!;
    // the full phase landing re-renders the list: nothing in the session is touched
    expect(s().toast).toBe(toast);
    expect(s().toast!.undoable).toBe(true);
    expect(s().history.at(-1)!.rec.id).toBe(recs[1].id);
    s().forget(nope);
    expect(s().history.map((e) => e.rec.id)).toEqual([recs[0].id]);
  });

  it("a row swiped left collapses at once (hiding) and is released when the backend answers", () => {
    s().hide(recs[2].id);
    s().hide(recs[2].id);
    expect(s().hiding).toEqual([recs[2].id]);
    s().unhide(recs[2].id);
    expect(s().hiding).toEqual([]);
  });

  it("a late timer only clears its own toast", () => {
    s().showToast("Learned: you like Rome", true);
    const first = s().toast!.id;
    s().showToast("Undone: Rome");
    s().clearToast(first);
    expect(s().toast?.text).toBe("Undone: Rome");
    expect(s().toast?.undoable).toBe(false);
  });
});

describe("a drag that started vertical never commits (review #56, mouse/pen)", () => {
  it("only an x-locked drag can like or hide", () => {
    expect(lockedSwipeIntent("y", 110, 0)).toBeNull(); // 30px up, then 110px right: the row never moved
    expect(lockedSwipeIntent("y", -200, -900)).toBeNull();
    expect(lockedSwipeIntent(null, 200, 0)).toBeNull();
    expect(lockedSwipeIntent("x", 110, 0)).toBe("like");
    expect(lockedSwipeIntent("x", -110, 0)).toBe("dislike");
  });
});

describe("rows drawn on /trips follow 'hiding' (review #56 blocker)", () => {
  const rows = recs.slice(0, 4);
  it("a 'Not for me' in flight is not drawn; a failed one (unhide) is drawn again in place, ranks untouched", () => {
    s().hide(rows[1].id);
    const during = shownRows(rows, s().hiding);
    expect(during.map((r) => r.id)).toEqual([rows[0].id, rows[2].id, rows[3].id]);
    expect(during.map((r) => r.rank)).toEqual([rows[0].rank, rows[2].rank, rows[3].rank]);
    s().unhide(rows[1].id); // the POST failed
    expect(shownRows(rows, s().hiding)).toEqual(rows);
  });
});
