"use client";

import { useEffect } from "react";
import { api } from "./api";
import { useHydrated, useTrip } from "./store";
import type { BridgeWindow, FreeWindow } from "./types";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Look-ahead used for the calendar + radar: today .. +9 months. */
export function horizon(): { from: string; to: string } {
  const now = new Date();
  const to = new Date(now);
  to.setUTCMonth(to.getUTCMonth() + 9);
  return { from: iso(now), to: iso(to) };
}

/** Free windows + długi weekend radar, fetched once and cached in the store. */
export function useWindows() {
  const hydrated = useHydrated();
  const { windows, longWeekends, setWindows, setMode } = useTrip();
  useEffect(() => {
    if (!hydrated || windows.length || longWeekends.length) return;
    const { from, to } = horizon();
    Promise.all([api.windows(from, to), api.longWeekends(from, to)]).then(([w, lw]) => {
      setWindows(w.data, lw.data);
      setMode(w.mode === "live" && lw.mode === "live" ? "live" : "fixture");
    });
  }, [hydrated, windows.length, longWeekends.length, setWindows, setMode]);
  return { windows, longWeekends, loading: !windows.length && !longWeekends.length };
}

export function bridgeFor(w: FreeWindow, radar: BridgeWindow[]): BridgeWindow | undefined {
  return radar.find((b) => b.window.start === w.start && b.window.end === w.end);
}
