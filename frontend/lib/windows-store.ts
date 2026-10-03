"use client";

/**
 * Dates the user picked on the Free time calendar (T4f), persisted per browser session in localStorage.
 * When there are any, they are sent as `windows` (FreeWindow source="manual") to POST /recommendations
 * and take priority over calendar-derived windows and the radar.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { addRange, type DateRange, pickQuick, type QuickKind, removeRange, toFreeWindows, toISO, usableRanges } from "./date-range";
import { useTrip } from "./store";
import type { FreeWindow } from "./types";

export const FLEX_OPTIONS = [1, 2, 3] as const;

interface DatesState {
  ranges: DateRange[];
  /** "I'm flexible ± N days"; 0 = exact dates. */
  flexDays: number;
  /** Windows the cached ranking was requested for (JSON); see datesChanged(). */
  sentKey: string | null;
  add: (r: DateRange) => void;
  /** quick filter chip: mutually exclusive with the other chips (see pickQuick) */
  pickQuick: (kind: QuickKind, r: DateRange) => void;
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
      sentKey: null,
      add: (r) => {
        set((s) => ({ ranges: addRange(s.ranges, r) }));
        invalidateRecs();
      },
      pickQuick: (kind, r) => {
        set((s) => ({ ranges: pickQuick(s.ranges, kind, r) }));
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

const currentWindows = () => {
  const { ranges, flexDays } = useDates.getState();
  return toFreeWindows(ranges, flexDays, todayISO());
};
export const datesKey = () => JSON.stringify(currentWindows());

/** Request fragment for POST /recommendations: `{ windows }` when the user picked dates, else nothing. */
export function pickedWindows(): { windows?: FreeWindow[] } {
  const windows = currentWindows();
  useDates.setState({ sentKey: JSON.stringify(windows) });
  return windows.length ? { windows } : {};
}

/**
 * The windows we'd send now differ from the ones the cached ranking was requested for: a picked range
 * ended or got clipped by a new day, or the dates were edited while a request was in flight.
 */
export const datesChanged = () => useDates.getState().sentKey !== datesKey();

/** Picked ranges that can still become a trip (what /recommendations actually gets). */
export function useUsableRanges(): DateRange[] {
  const ranges = useDates((s) => s.ranges);
  return usableRanges(ranges, todayISO());
}
