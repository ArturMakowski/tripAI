import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  MAX_WINDOWS,
  rangeDays,
  usableRanges,
  anyDaysNextMonth,
  activeRanges,
  addRange,
  pickQuick,
  isQuickOn,
  easterSunday,
  holidaysBetween,
  localBridges,
  mergeSuggestions,
  monthGrid,
  monthsAhead,
  moveFocus,
  nextSuggestion,
  normalizeRanges,
  polishHolidays,
  previewRange,
  removeRange,
  tapDay,
  thisWeekend,
  toFreeWindows,
  type Selection,
} from "./date-range";
import type { BridgeWindow } from "./types";

const TODAY = "2026-10-03"; // a Saturday
const empty: Selection = { ranges: [], anchor: null };

describe("tap-tap range selection", () => {
  it("first tap anchors, second tap adds the range", () => {
    const a = tapDay(empty, "2026-11-10", TODAY);
    expect(a).toEqual({ ranges: [], anchor: "2026-11-10" });
    const b = tapDay(a, "2026-11-14", TODAY);
    expect(b.anchor).toBeNull();
    expect(b.ranges).toEqual([{ start: "2026-11-10", end: "2026-11-14" }]);
    expect(b.added).toEqual({ start: "2026-11-10", end: "2026-11-14" });
  });

  it("works backwards (end tapped before start)", () => {
    const b = tapDay(tapDay(empty, "2026-11-14", TODAY), "2026-11-10", TODAY);
    expect(b.ranges).toEqual([{ start: "2026-11-10", end: "2026-11-14" }]);
  });

  it("tapping the anchor again cancels it (a one-day trip is too short)", () => {
    const b = tapDay(tapDay(empty, "2026-12-01", TODAY), "2026-12-01", TODAY);
    expect(b).toEqual({ ranges: [], anchor: null });
  });

  it("ignores past days", () => {
    expect(tapDay(empty, "2026-10-02", TODAY)).toBe(empty);
  });

  it("supports several ranges and merges overlapping or touching ones", () => {
    let s: Selection = empty;
    for (const day of ["2026-11-10", "2026-11-12", "2027-02-12", "2027-02-20", "2026-11-13", "2026-11-15"]) s = tapDay(s, day, TODAY);
    expect(s.ranges).toEqual([
      { start: "2026-11-10", end: "2026-11-15" },
      { start: "2027-02-12", end: "2027-02-20" },
    ]);
  });

  it("removes a range", () => {
    const ranges = addRange(addRange([], { start: "2026-11-10", end: "2026-11-12" }), { start: "2027-01-01", end: "2027-01-03" });
    expect(removeRange(ranges, { start: "2026-11-10", end: "2026-11-12" })).toEqual([{ start: "2027-01-01", end: "2027-01-03" }]);
  });

  it("keeps 'any N days' months separate from day ranges", () => {
    const r = normalizeRanges([
      { start: "2026-11-01", end: "2026-11-30", anyDays: 5 },
      { start: "2026-11-10", end: "2026-11-12" },
    ]);
    expect(r).toHaveLength(2);
  });

  it("previews anchor..hover in either direction", () => {
    expect(previewRange(null, "2026-11-10")).toBeNull();
    expect(previewRange("2026-11-10", "2026-11-07")).toEqual({ start: "2026-11-07", end: "2026-11-10" });
    expect(previewRange("2026-11-10", null)).toEqual({ start: "2026-11-10", end: "2026-11-10" });
  });

  it("drops finished ranges and clips running ones to today", () => {
    expect(
      activeRanges(
        [
          { start: "2026-09-01", end: "2026-09-05" },
          { start: "2026-10-01", end: "2026-10-05" },
        ],
        TODAY,
      ),
    ).toEqual([{ start: TODAY, end: "2026-10-05" }]);
  });
});

describe("to FreeWindow(source='manual')", () => {
  it("sends exact dates", () => {
    expect(toFreeWindows([{ start: "2027-02-12", end: "2027-02-20" }], 0, TODAY)).toEqual([
      { start: "2027-02-12", end: "2027-02-20", source: "manual" },
    ]);
  });

  it("flexible ± N adds same-length trips shifted earlier and later, exact dates first, never in the past", () => {
    const w = toFreeWindows([{ start: "2026-11-11", end: "2026-11-15" }], 2, TODAY).map((x) => `${x.start}_${x.end}`);
    expect(w).toEqual([
      "2026-11-11_2026-11-15",
      "2026-11-10_2026-11-14",
      "2026-11-12_2026-11-16",
      "2026-11-09_2026-11-13",
      "2026-11-13_2026-11-17",
    ]);
    const near = toFreeWindows([{ start: "2026-10-04", end: "2026-10-06" }], 2, TODAY).map((x) => x.start);
    expect(near).toEqual(["2026-10-04", "2026-10-03", "2026-10-05", "2026-10-06"]); // 2 Oct is in the past
  });

  it("any N days in a month: exact N-day trips across the whole month", () => {
    const w = toFreeWindows([anyDaysNextMonth(TODAY, 5)], 0, TODAY);
    expect(w.every((x) => rangeDays(x) === 5)).toBe(true);
    expect(w[0]).toEqual({ start: "2026-11-01", end: "2026-11-05", source: "manual" });
    expect(w.at(-1)).toEqual({ start: "2026-11-26", end: "2026-11-30", source: "manual" });
    expect(w).toHaveLength(14); // starts 1, 3, …, 25 + the last one ending 30 Nov
  });

  it("never sends windows too short for a trip (the backend drops them)", () => {
    expect(toFreeWindows([{ start: "2026-10-01", end: "2026-10-03" }], 0, TODAY)).toEqual([]); // clipped to 1 day
    expect(usableRanges([{ start: "2026-10-01", end: "2026-10-04" }], TODAY)).toEqual([{ start: TODAY, end: "2026-10-04" }]);
  });

  it("caps the request at 60 windows", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ start: addDays("2026-11-01", i * 10), end: addDays("2026-11-01", i * 10 + 3) }));
    expect(toFreeWindows(many, 3, TODAY)).toHaveLength(MAX_WINDOWS);
  });
});

describe("calendar grid + keyboard", () => {
  it("builds a Monday-first grid", () => {
    const g = monthGrid("2026-10"); // 1 Oct 2026 is a Thursday
    expect(g[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(g.flat().filter(Boolean)).toHaveLength(31);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });

  it("lists the next 12 months", () => {
    expect(monthsAhead(TODAY)).toHaveLength(12);
    expect(monthsAhead(TODAY).at(-1)).toBe("2027-09");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("moves focus with arrows, Home/End and PageUp/PageDown", () => {
    expect(moveFocus("2026-10-31", "ArrowRight")).toBe("2026-11-01");
    expect(moveFocus("2026-10-07", "ArrowUp")).toBe("2026-09-30");
    expect(moveFocus("2026-10-07", "Home")).toBe("2026-10-05"); // Wednesday -> Monday
    expect(moveFocus("2026-10-07", "End")).toBe("2026-10-11");
    expect(moveFocus("2027-01-31", "PageDown")).toBe("2027-02-28"); // clamped to month length
    expect(moveFocus("2026-10-07", "Tab")).toBeNull();
  });
});

describe("Polish public holidays", () => {
  it("computes Easter", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2024)).toBe("2024-03-31");
  });

  it("has all 14 statutory days off including Wigilia and the movable feasts", () => {
    const h = polishHolidays(2027);
    expect(h).toHaveLength(14);
    const at = Object.fromEntries(h.map((x) => [x.key, x.date]));
    expect(at.easterMonday).toBe("2027-03-29");
    expect(at.pentecost).toBe("2027-05-16");
    expect(at.corpusChristi).toBe("2027-05-27");
    expect(at.christmasEve).toBe("2027-12-24");
    expect(at.independence).toBe("2027-11-11");
  });

  it("filters to a date span across years", () => {
    const keys = holidaysBetween(TODAY, "2027-01-10").map((h) => h.key);
    expect(keys).toEqual(["allSaints", "independence", "christmasEve", "christmas", "boxingDay", "newYear", "epiphany"]);
  });
});

describe("long-weekend suggestions + quick chips", () => {
  const bridges = localBridges(TODAY, "2027-09-30");

  it("bridges Wednesday 11 Nov 2026 to the weekend with 2 days off", () => {
    expect(bridges.find((b) => b.holidays.includes("2026-11-11"))).toMatchObject({
      start: "2026-11-11",
      end: "2026-11-15",
      leave: ["2026-11-12", "2026-11-13"],
    });
  });

  it("finds Corpus Christi 2027 (Thursday) -> 4 days for 1 day off", () => {
    expect(bridges.find((b) => b.holidays.includes("2027-05-27"))).toMatchObject({
      start: "2027-05-27",
      end: "2027-05-30",
      leave: ["2027-05-28"],
    });
  });

  it("merges Christmas Eve to Boxing Day with the weekend", () => {
    const xmas = bridges.find((b) => b.holidays.includes("2026-12-25"))!;
    expect(xmas.start <= "2026-12-24" && xmas.end >= "2026-12-27").toBe(true);
  });

  it("prefers the backend radar where it has an entry", () => {
    const radar: BridgeWindow[] = [
      {
        window: { start: "2026-11-07", end: "2026-11-11", source: "radar" },
        total_days: 5,
        leave_days: ["2026-11-09", "2026-11-10"],
        holidays: [{ date: "2026-11-11", name: "Narodowe Święto Niepodległości", source: "nager" }],
        label: "",
      },
    ];
    const merged = mergeSuggestions(radar, bridges);
    const nov = merged.filter((s) => s.holidays.includes("2026-11-11"));
    expect(nov).toHaveLength(1);
    expect(nov[0].names).toEqual(["Narodowe Święto Niepodległości"]);
  });

  it("quick chips: this weekend, next long weekend, any 5 days next month", () => {
    expect(thisWeekend(TODAY)).toEqual({ start: "2026-10-03", end: "2026-10-04" });
    expect(thisWeekend("2026-10-07")).toEqual({ start: "2026-10-10", end: "2026-10-11" });
    expect(thisWeekend("2026-10-04")).toEqual({ start: "2026-10-10", end: "2026-10-11" }); // Sunday -> next weekend
    expect(nextSuggestion(bridges, TODAY)?.holidays).toContain("2026-11-11"); // 1 Nov 2026 is a Sunday
    expect(anyDaysNextMonth(TODAY)).toEqual({ start: "2026-11-01", end: "2026-11-30", anyDays: 5 });
  });
});

describe("quick filters are radios (round 3)", () => {
  const weekend = { start: "2026-10-10", end: "2026-10-11" };
  const long = { start: "2026-11-07", end: "2026-11-11" };
  const custom = { start: "2026-12-01", end: "2026-12-05" };
  it("picking one quick filter replaces the previous one; calendar ranges stay", () => {
    let r = pickQuick([custom], "weekend", weekend);
    expect(r.map((x) => x.start)).toEqual(["2026-10-10", "2026-12-01"]);
    r = pickQuick(r, "long", long);
    expect(r.map((x) => [x.start, x.quick ?? null])).toEqual([
      ["2026-11-07", "long"],
      ["2026-12-01", null],
    ]);
  });
  it("a quick pick that sorts first never takes over a range drawn next to it (review #41)", () => {
    let r = pickQuick([], "weekend", { start: "2026-10-10", end: "2026-10-11" });
    r = addRange(r, { start: "2026-10-11", end: "2026-10-14" });
    expect(r).toHaveLength(2);
    r = pickQuick(r, "long", long);
    expect(r.map((x) => [x.start, x.end, x.quick ?? null])).toEqual([
      ["2026-10-11", "2026-10-14", null],
      ["2026-11-07", "2026-11-11", "long"],
    ]);
  });
  it("a drawn range that sorts first never swallows the quick pick", () => {
    const r = pickQuick([{ start: "2026-10-07", end: "2026-10-09" }], "weekend", { start: "2026-10-10", end: "2026-10-11" });
    expect(r.find((x) => x.quick === "weekend")).toBeTruthy();
    expect(pickQuick(r, "weekend", { start: "2026-10-10", end: "2026-10-11" })).toEqual([{ start: "2026-10-07", end: "2026-10-09" }]);
  });
  it("a stale pick of the same kind is replaced by the chip's current range, not cleared", () => {
    const nov = { start: "2026-11-01", end: "2026-11-30", anyDays: 5 };
    const dec = { start: "2026-12-01", end: "2026-12-31", anyDays: 5 };
    const r = pickQuick(pickQuick([], "any", nov), "any", dec);
    expect(r.map((x) => x.start)).toEqual(["2026-12-01"]);
    expect(isQuickOn(r, "any", nov)).toBe(false);
    expect(isQuickOn(r, "any", dec)).toBe(true);
  });
  it("picking the selected one again clears it", () => {
    const r = pickQuick(pickQuick([], "weekend", weekend), "weekend", weekend);
    expect(r).toEqual([]);
  });
});
