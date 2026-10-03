import { describe, expect, it } from "vitest";
import { nextFreeWindow, nextLongWeekend, nextPicked } from "./home-today";
import type { BridgeWindow } from "./types";

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
    expect(nextLongWeekend(radar, "2026-10-04")).toMatchObject({ start: "2026-11-07", end: "2026-11-11", leave: 2, total: 5, holiday: { key: "independence" } });
  });
});

describe("nextPicked (the ranges /trips still searches)", () => {
  it("clips to today", () => {
    expect(nextPicked([{ start: "2026-10-02", end: "2026-10-06" }], "2026-10-04")).toMatchObject({ start: "2026-10-04", total: 3, kind: "picked" });
  });

  it("an 'any N days' range clipped to today counts only the days left", () => {
    expect(nextPicked([{ start: "2026-11-01", end: "2026-11-30", anyDays: 5 }], "2026-10-04")?.total).toBe(5);
    expect(nextPicked([{ start: "2026-10-01", end: "2026-10-06", anyDays: 5 }], "2026-10-04")?.total).toBe(3);
  });

  it("drops ended ranges and a tail shorter than a trip", () => {
    expect(nextPicked([{ start: "2026-09-01", end: "2026-09-03" }], "2026-10-04")).toBeNull();
    expect(nextPicked([{ start: "2026-10-01", end: "2026-10-04" }], "2026-10-04")).toBeNull();
  });
});

describe("nextFreeWindow", () => {
  it("shows whichever comes first: the user's dates or the next long weekend", () => {
    expect(nextFreeWindow([], [], "2026-10-04")?.kind).toBe("longWeekend");
    expect(nextFreeWindow([{ start: "2026-10-20", end: "2026-10-25" }], [], "2026-10-04")?.kind).toBe("picked");
    expect(nextFreeWindow([{ start: "2027-01-14", end: "2027-01-19" }], [], "2026-10-04")?.start).toBe("2026-11-11");
  });
});
