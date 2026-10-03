/**
 * The returning-user home's "today" summary (T16): the #1 trip from the ranking already on the device and
 * the next free window / długi weekend. Pure functions over stored data: nothing here fetches.
 */
import {
  type DateRange,
  type HolidayKey,
  type ISODate,
  type Suggestion,
  holidaysBetween,
  localBridges,
  mergeSuggestions,
  monthEnd,
  monthsAhead,
  rangeDays,
} from "./date-range";
import type { BridgeWindow, RankedRecommendation } from "./types";

/** The best-ranked stored trip that hasn't started yet (a ranking from last week may hold past windows). */
export function topPick(recs: RankedRecommendation[], today: ISODate): RankedRecommendation | null {
  return recs.filter((r) => r.window.start >= today).reduce<RankedRecommendation | null>((best, r) => (!best || r.rank < best.rank ? r : best), null);
}

export interface NextWindow {
  start: ISODate;
  end: ISODate;
  /** days in the window */
  total: number;
  /** working days to take off (0 for dates the user picked) */
  leave: number;
  kind: "picked" | "longWeekend";
  /** the PL holiday the long weekend is built around */
  holiday?: { key: HolidayKey } | { name: string };
}

/** Next long weekend: the backend radar (already in the store) first, local PL holidays + bridge days for the rest. */
export function nextLongWeekend(radar: BridgeWindow[], today: ISODate): NextWindow | null {
  const horizonEnd = monthEnd(monthsAhead(today, 12)[11]);
  const s: Suggestion | undefined = mergeSuggestions(radar, localBridges(today, horizonEnd)).find((x) => x.start >= today);
  if (!s) return null;
  const local = s.holidays.length ? holidaysBetween(s.holidays[0], s.holidays[0])[0] : undefined;
  return {
    start: s.start,
    end: s.end,
    total: rangeDays(s),
    leave: s.leave.length,
    kind: "longWeekend",
    holiday: local ? { key: local.key } : s.names?.[0] ? { name: s.names[0] } : undefined,
  };
}

/** The user's next picked range that hasn't ended ("any N days" ranges count as N days). */
export function nextPicked(ranges: DateRange[], today: ISODate): NextWindow | null {
  const r = ranges.filter((x) => x.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!r) return null;
  const start = r.start < today ? today : r.start;
  return { start, end: r.end, total: r.anyDays ?? rangeDays({ start, end: r.end }), leave: 0, kind: "picked" };
}

/**
 * At most two rows: the user's own dates (they drive the ranking) and the next long weekend, unless it
 * starts inside the picked range anyway.
 */
export function freeWindows(ranges: DateRange[], radar: BridgeWindow[], today: ISODate): NextWindow[] {
  const picked = nextPicked(ranges, today);
  const long = nextLongWeekend(radar, today);
  const out = picked ? [picked] : [];
  if (long && !(picked && long.start <= picked.end && picked.start <= long.end)) out.push(long);
  return out;
}
