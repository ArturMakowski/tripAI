/**
 * The returning-user home's "today" summary (T16): the next free window, from the user's picked dates and
 * the długi weekend radar. The "#1" comes from the same selector as /trips (lib/trip-list.ts). Pure
 * functions over stored data: nothing here fetches.
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
  usableRanges,
} from "./date-range";
import type { BridgeWindow } from "./types";

export interface NextWindow {
  start: ISODate;
  end: ISODate;
  /** days in the window (an "any N days" range: N, or fewer if fewer are left) */
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

/** The user's next picked range that /trips still searches (usableRanges: clipped to today, long enough). */
export function nextPicked(ranges: DateRange[], today: ISODate): NextWindow | null {
  const r = usableRanges(ranges, today).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!r) return null;
  const days = rangeDays(r);
  return { start: r.start, end: r.end, total: r.anyDays ? Math.min(r.anyDays, days) : days, leave: 0, kind: "picked" };
}

/** One row: whichever comes first, the user's own dates or the next long weekend. */
export function nextFreeWindow(ranges: DateRange[], radar: BridgeWindow[], today: ISODate): NextWindow | null {
  const picked = nextPicked(ranges, today);
  const long = nextLongWeekend(radar, today);
  if (!picked || !long) return picked ?? long;
  return long.start < picked.start ? long : picked;
}
