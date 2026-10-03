"use client";

/**
 * Dates the user picked on the Free time calendar (T4f), persisted per browser session in localStorage.
 * When there are any, they are sent as `windows` (FreeWindow source="manual") to POST /recommendations
 * and take priority over calendar-derived windows and the radar.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { activeRanges, addRange, type DateRange, removeRange, toFreeWindows, toISO } from "./date-range";
import { useTrip } from "./store";
import type { FreeWindow } from "./types";

export const FLEX_OPTIONS = [1, 2, 3] as const;

interface DatesState {
  ranges: DateRange[];
  /** "I'm flexible ± N days"; 0 = exact dates. */
  flexDays: number;
  add: (r: DateRange) => void;
  remove: (r: Pick<DateRange, "start" | "end">) => void;
  clear: () => void;
  setFlex: (days: number) => void;
}

/** Cached rankings were scored for other windows: drop them so /trips refetches. */
const invalidateRecs = () => useTrip.setState({ recs: [], recsMeta: null });

export const useDates = create<DatesState>()(
  persist(
    (set) => ({
      ranges: [],
      flexDays: 0,
      add: (r) => {
        set((s) => ({ ranges: addRange(s.ranges, r) }));
        invalidateRecs();
      },
      remove: (r) => {
        set((s) => ({ ranges: removeRange(s.ranges, r) }));
        invalidateRecs();
      },
      clear: () => {
        set({ ranges: [] });
        invalidateRecs();
      },
      setFlex: (flexDays) => {
        set({ flexDays });
        invalidateRecs();
      },
    }),
    { name: "tripai-dates-v1", storage: createJSONStorage(() => localStorage) },
  ),
);

export const todayISO = () => toISO(new Date());

/** Request fragment for POST /recommendations: `{ windows }` when the user picked dates, else nothing. */
export function pickedWindows(): { windows?: FreeWindow[] } {
  const { ranges, flexDays } = useDates.getState();
  const windows = toFreeWindows(ranges, flexDays, todayISO());
  return windows.length ? { windows } : {};
}

/** Picked ranges that haven't ended yet. */
export function useActiveRanges(): DateRange[] {
  const ranges = useDates((s) => s.ranges);
  return activeRanges(ranges, todayISO());
}
