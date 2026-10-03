import { describe, expect, it } from "vitest";
import { freeWindows, nextLongWeekend, nextPicked, topPick } from "./home-today";
import type { BridgeWindow, RankedRecommendation } from "./types";

const rec = (id: string, rank: number, start: string, end: string) => ({ id, rank, window: { start, end, source: "gcal" } }) as RankedRecommendation;

describe("topPick", () => {
  it("picks the best rank among trips that haven't started", () => {
    const recs = [rec("a", 2, "2026-11-11", "2026-11-15"), rec("b", 1, "2026-10-01", "2026-10-05"), rec("c", 3, "2027-01-14", "2027-01-19")];
    // b ranked #1 but already started: a is the #1 still bookable
    expect(topPick(recs, "2026-10-04")?.id).toBe("a");
    expect(topPick(recs, "2026-09-30")?.id).toBe("b");
  });

  it("is null without a stored ranking (no search is triggered for it)", () => {
    expect(topPick([], "2026-10-04")).toBeNull();
    expect(topPick([rec("a", 1, "2026-01-01", "2026-01-03")], "2026-10-04")).toBeNull();
  });
});

describe("nextLongWeekend", () => {
  it("finds 11 Nov from the local PL holidays (Wed → take Thu+Fri off → 5 days)", () => {
    // 1 Nov 2026 is a Sunday, so Independence Day is the next one
    expect(nextLongWeekend([], "2026-10-04")).toEqual({
      start: "2026-11-11",
      end: "2026-11-15",
      total: 5,
      leave: 2,
      kind: "longWeekend",
      holiday: { key: "independence" },
    });
  });

  it("prefers the backend radar already in the store", () => {
    const radar: BridgeWindow[] = [
      {
        window: { start: "2026-11-07", end: "2026-11-11", source: "radar" },
        total_days: 5,
        leave_days: ["2026-11-09", "2026-11-10"],
        holidays: [{ date: "2026-11-11", name: "Narodowe Święto Niepodległości", source: "nager" }],
        label: "",
      },
    ];
    const w = nextLongWeekend(radar, "2026-10-04");
    expect(w).toMatchObject({ start: "2026-11-07", end: "2026-11-11", leave: 2, total: 5, holiday: { key: "independence" } });
  });
});

describe("free windows", () => {
  it("shows the user's next picked dates, clipped to today", () => {
    expect(nextPicked([{ start: "2026-10-02", end: "2026-10-06" }], "2026-10-04")).toMatchObject({ start: "2026-10-04", total: 3, kind: "picked" });
    expect(nextPicked([{ start: "2026-11-01", end: "2026-11-30", anyDays: 5 }], "2026-10-04")?.total).toBe(5);
    expect(nextPicked([{ start: "2026-09-01", end: "2026-09-03" }], "2026-10-04")).toBeNull();
  });

  it("lists at most two rows and drops a long weekend inside the picked dates", () => {
    expect(freeWindows([], [], "2026-10-04").map((w) => w.kind)).toEqual(["longWeekend"]);
    expect(freeWindows([{ start: "2027-01-14", end: "2027-01-19" }], [], "2026-10-04").map((w) => w.kind)).toEqual(["picked", "longWeekend"]);
    expect(freeWindows([{ start: "2026-11-10", end: "2026-11-16" }], [], "2026-10-04").map((w) => w.kind)).toEqual(["picked"]);
  });
});
