/**
 * Pure date logic behind the Free time calendar (T4f): ISO day math, tap-tap range
 * selection, merging, Polish public holidays, long-weekend suggestions and quick chips.
 * Everything works on "YYYY-MM-DD" strings at UTC noon, like lib/format.ts, so there are no
 * timezone or DST surprises. No React here: lib/date-range.test.ts pins it.
 */
import type { BridgeWindow, FreeWindow } from "./types";

export type ISODate = string;

export interface DateRange {
  start: ISODate;
  end: ISODate;
  /** "any N days in <month>": the whole month is the window, the scorer picks N days in it. */
  anyDays?: number;
}

const DAY = 86_400_000;
const d = (iso: ISODate) => new Date(`${iso}T12:00:00Z`);
const fmt = (t: Date) => t.toISOString().slice(0, 10);

export const toISO = (date: Date): ISODate =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const addDays = (iso: ISODate, n: number): ISODate => fmt(new Date(d(iso).getTime() + n * DAY));
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((d(b).getTime() - d(a).getTime()) / DAY);
export const rangeDays = (r: Pick<DateRange, "start" | "end">) => diffDays(r.start, r.end) + 1;
/** 0 = Monday … 6 = Sunday (Polish calendars start on Monday). */
export const dowMon = (iso: ISODate) => (d(iso).getUTCDay() + 6) % 7;
export const isWeekend = (iso: ISODate) => dowMon(iso) >= 5;
export const inRange = (iso: ISODate, r: Pick<DateRange, "start" | "end">) => iso >= r.start && iso <= r.end;
export const overlaps = (a: Pick<DateRange, "start" | "end">, b: Pick<DateRange, "start" | "end">) => a.start <= b.end && b.start <= a.end;

/** "2026-10" for a date. */
export const monthKey = (iso: ISODate) => iso.slice(0, 7);
export const monthStart = (key: string): ISODate => `${key}-01`;
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return fmt(t).slice(0, 7);
}
export const monthEnd = (key: string): ISODate => addDays(monthStart(addMonths(key, 1)), -1);

/** The next `count` months starting with the month of `today`. */
export const monthsAhead = (today: ISODate, count = 12) => Array.from({ length: count }, (_, i) => addMonths(monthKey(today), i));

/** 6×7 Monday-first grid for a month; days outside it are null. */
export function monthGrid(key: string): (ISODate | null)[][] {
  const first = monthStart(key);
  const len = rangeDays({ start: first, end: monthEnd(key) });
  const cells: (ISODate | null)[] = [...Array(dowMon(first)).fill(null), ...Array.from({ length: len }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

// --- selection ---------------------------------------------------------------------------

/** Sorted, with overlapping or touching ranges merged ("any N days" months stay as they are). */
export function normalizeRanges(ranges: DateRange[]): DateRange[] {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const out: DateRange[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && !last.anyDays && !r.anyDays && r.start <= addDays(last.end, 1)) {
      if (r.end > last.end) out[out.length - 1] = { ...last, end: r.end };
    } else if (!out.some((x) => x.start === r.start && x.end === r.end)) {
      out.push({ ...r });
    }
  }
  return out;
}

export function addRange(ranges: DateRange[], r: DateRange): DateRange[] {
  const [start, end] = r.start <= r.end ? [r.start, r.end] : [r.end, r.start];
  return normalizeRanges([...ranges, { ...r, start, end }]);
}

export const removeRange = (ranges: DateRange[], r: Pick<DateRange, "start" | "end">) =>
  ranges.filter((x) => !(x.start === r.start && x.end === r.end));

/** Ranges that are completely in the past are dropped; a range already under way starts today. */
export const activeRanges = (ranges: DateRange[], today: ISODate) =>
  ranges.filter((r) => r.end >= today).map((r) => (r.start < today ? { ...r, start: today } : r));

export interface Selection {
  ranges: DateRange[];
  /** First tap of a tap-tap selection, waiting for the second. */
  anchor: ISODate | null;
}

export type TapResult = Selection & { added?: DateRange };

/**
 * Tap-tap range selection. The first tap sets the anchor, the second one adds anchor..day
 * (either order). Tapping the anchor again cancels it. Past days are ignored.
 */
export function tapDay(sel: Selection, day: ISODate, today: ISODate): TapResult {
  if (day < today) return sel;
  if (!sel.anchor) return { ...sel, anchor: day };
  // Tapping the anchor again un-taps it: a one-day "trip" is too short for the scorer (MIN_TRIP_DAYS).
  if (sel.anchor === day) return { ...sel, anchor: null };
  const added = sel.anchor <= day ? { start: sel.anchor, end: day } : { start: day, end: sel.anchor };
  return { ranges: addRange(sel.ranges, added), anchor: null, added };
}

/** The range being previewed while the user hovers/focuses a day after the first tap. */
export function previewRange(anchor: ISODate | null, hover: ISODate | null): DateRange | null {
  if (!anchor) return null;
  const other = hover ?? anchor;
  return anchor <= other ? { start: anchor, end: other } : { start: other, end: anchor };
}

/** Keyboard navigation inside the grid (arrows, Home/End within the week, PageUp/PageDown by month). */
export function moveFocus(iso: ISODate, key: string): ISODate | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(iso, -1);
    case "ArrowRight":
      return addDays(iso, 1);
    case "ArrowUp":
      return addDays(iso, -7);
    case "ArrowDown":
      return addDays(iso, 7);
    case "Home":
      return addDays(iso, -dowMon(iso));
    case "End":
      return addDays(iso, 6 - dowMon(iso));
    case "PageUp":
    case "PageDown": {
      const key2 = addMonths(monthKey(iso), key === "PageUp" ? -1 : 1);
      const day = Math.min(Number(iso.slice(8)), Number(monthEnd(key2).slice(8)));
      return `${key2}-${String(day).padStart(2, "0")}`;
    }
    default:
      return null;
  }
}

// --- to the API -------------------------------------------------------------------------

/** The backend drops windows shorter than this (scoring/windows.py trip_windows). */
export const MIN_TRIP_DAYS = 2;
/** POST /recommendations accepts at most this many windows (api/schemas.py). */
export const MAX_WINDOWS = 60;
/** "Any N days in <month>": an N-day trip starting every this many days across the month. */
export const ANY_DAYS_STEP = 2;

/** Picked ranges that can still become a trip: not over yet and at least MIN_TRIP_DAYS long from today. */
export const usableRanges = (ranges: DateRange[], today: ISODate) =>
  activeRanges(ranges, today).filter((r) => rangeDays(r) >= MIN_TRIP_DAYS);

/**
 * Selected ranges -> concrete FreeWindow(source="manual") list for POST /recommendations. Every window is
 * an exact trip, so the scorer prices what the UI promised:
 *  - a range is sent as is;
 *  - "I'm flexible ± N" adds the same-length trip shifted 1..N days earlier and later (never into the past);
 *  - "any N days in <month>" sends N-day trips starting every ANY_DAYS_STEP days, the last one ending on the
 *    month's last day.
 * Exact dates come first, then the smallest shifts, capped at MAX_WINDOWS.
 */
export function toFreeWindows(ranges: DateRange[], flexDays: number, today: ISODate): FreeWindow[] {
  const flex = Math.max(0, Math.round(flexDays));
  const tiers: { start: ISODate; end: ISODate }[][] = Array.from({ length: flex + 1 }, () => []);
  const slices: { start: ISODate; end: ISODate }[] = [];
  for (const r of usableRanges(ranges, today)) {
    if (r.anyDays) {
      const n = Math.min(r.anyDays, rangeDays(r));
      const lastStart = addDays(r.end, -(n - 1));
      for (let s = r.start; s <= lastStart; s = addDays(s, ANY_DAYS_STEP)) slices.push({ start: s, end: addDays(s, n - 1) });
      if (!slices.some((x) => x.start === lastStart)) slices.push({ start: lastStart, end: r.end });
      continue;
    }
    tiers[0].push(r);
    for (let k = 1; k <= flex; k++)
      for (const shift of [-k, k]) {
        const start = addDays(r.start, shift);
        if (start >= today) tiers[k].push({ start, end: addDays(r.end, shift) });
      }
  }
  const seen = new Set<string>();
  return [...tiers[0], ...slices, ...tiers.slice(1).flat()]
    .filter((w) => !seen.has(w.start + w.end) && !!seen.add(w.start + w.end))
    .slice(0, MAX_WINDOWS)
    .map(({ start, end }) => ({ start, end, source: "manual" }));
}

// --- Polish public holidays ---------------------------------------------------------------

export type HolidayKey =
  | "newYear"
  | "epiphany"
  | "easter"
  | "easterMonday"
  | "labour"
  | "constitution"
  | "pentecost"
  | "corpusChristi"
  | "assumption"
  | "allSaints"
  | "independence"
  | "christmasEve"
  | "christmas"
  | "boxingDay";

export interface PlHoliday {
  date: ISODate;
  key: HolidayKey;
}

/** Western (Gregorian) Easter Sunday, anonymous Gregorian algorithm. */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const dd = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Statutory days off in Poland (ustawa o dniach wolnych od pracy; Wigilia since 2025). */
export function polishHolidays(year: number): PlHoliday[] {
  const easter = easterSunday(year);
  const fixed: [string, HolidayKey][] = [
    ["01-01", "newYear"],
    ["01-06", "epiphany"],
    ["05-01", "labour"],
    ["05-03", "constitution"],
    ["08-15", "assumption"],
    ["11-01", "allSaints"],
    ["11-11", "independence"],
    ...(year >= 2025 ? ([["12-24", "christmasEve"]] as [string, HolidayKey][]) : []),
    ["12-25", "christmas"],
    ["12-26", "boxingDay"],
  ];
  return [
    ...fixed.map(([md, key]) => ({ date: `${year}-${md}`, key })),
    { date: easter, key: "easter" as const },
    { date: addDays(easter, 1), key: "easterMonday" as const },
    { date: addDays(easter, 49), key: "pentecost" as const },
    { date: addDays(easter, 60), key: "corpusChristi" as const },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function holidaysBetween(from: ISODate, to: ISODate): PlHoliday[] {
  const out: PlHoliday[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    out.push(...polishHolidays(y).filter((h) => h.date >= from && h.date <= to));
  return out;
}

// --- long-weekend suggestions ---------------------------------------------------------------

export interface Suggestion {
  start: ISODate;
  end: ISODate;
  /** Working days to take off. */
  leave: ISODate[];
  holidays: ISODate[];
  /** Holiday names when the backend radar supplied them. */
  names?: string[];
}

/**
 * Local długi weekend radar: every holiday on a weekday, stretched to the nearest weekend with at most
 * `maxLeave` days off (Tue -> Sat..Tue, Thu -> Thu..Sun, Wed -> Wed..Sun). Used for the months the backend
 * radar doesn't cover; backend entries always win (see mergeSuggestions).
 */
export function localBridges(from: ISODate, to: ISODate, maxLeave = 2): Suggestion[] {
  const hol = new Set(holidaysBetween(addDays(from, -7), addDays(to, 7)).map((h) => h.date));
  const off = (iso: ISODate) => isWeekend(iso) || hol.has(iso);
  const out: Suggestion[] = [];
  for (const h of [...hol].sort()) {
    if (isWeekend(h) || h < from || h > to) continue;
    const dow = dowMon(h);
    // stretch towards the closer weekend: back to Saturday for Mon/Tue, forward to Sunday otherwise
    let start = dow <= 1 ? addDays(h, -(dow + 2)) : h;
    let end = dow <= 1 ? h : addDays(h, 6 - dow);
    // grow over neighbouring days off (Christmas, 1 + 3 May, Easter Monday …)
    while (off(addDays(start, -1))) start = addDays(start, -1);
    while (off(addDays(end, 1))) end = addDays(end, 1);
    const days = Array.from({ length: rangeDays({ start, end }) }, (_, i) => addDays(start, i));
    const leave = days.filter((x) => !off(x));
    if (leave.length > maxLeave || rangeDays({ start, end }) < 3) continue;
    const clipped = start < from ? from : start;
    if (out.some((s) => s.start === clipped && s.end === end)) continue;
    out.push({ start: clipped, end, leave, holidays: days.filter((x) => hol.has(x)) });
  }
  return out;
}

/** Backend radar first (it knows the user's calendar), local bridges only where it has nothing. */
export function mergeSuggestions(radar: BridgeWindow[], local: Suggestion[]): Suggestion[] {
  const fromRadar: Suggestion[] = radar
    .filter((b) => b.leave_days.length > 0 || b.holidays.length > 0)
    .map((b) => ({
      start: b.window.start,
      end: b.window.end,
      leave: b.leave_days,
      holidays: b.holidays.map((h) => h.date),
      names: [...new Set(b.holidays.map((h) => h.name))],
    }));
  const rest = local.filter((l) => !fromRadar.some((r) => overlaps(r, l)));
  return [...fromRadar, ...rest].sort((a, b) => a.start.localeCompare(b.start));
}

// --- quick chips --------------------------------------------------------------------------

/** Saturday–Sunday of this week; on a Sunday (one day left, too short for a trip) next weekend. */
export function thisWeekend(today: ISODate): DateRange {
  const sat = addDays(today, dowMon(today) === 6 ? 6 : 5 - dowMon(today));
  return { start: sat < today ? today : sat, end: addDays(sat, 1) };
}

/** True when thisWeekend() had to jump to next week (the chip then says "Next weekend"). */
export const weekendIsNext = (today: ISODate) => dowMon(today) === 6;

export const nextSuggestion = (s: Suggestion[], today: ISODate) => s.find((x) => x.start >= today);

/** Next calendar month as an "any N days" window (Nov when today is in Oct). */
export function anyDaysNextMonth(today: ISODate, n = 5): DateRange {
  const key = addMonths(monthKey(today), 1);
  return { start: monthStart(key), end: monthEnd(key), anyDays: n };
}
