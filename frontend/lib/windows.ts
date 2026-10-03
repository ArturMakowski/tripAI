"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { useHydrated, useTrip, WINDOWS_TTL_MS } from "./store";
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
  const { windows, longWeekends, windowsAt, setWindows } = useTrip();
  const [now] = useState(() => Date.now()); // staleness is judged once per mount
  const fresh = windowsAt != null && now - windowsAt < WINDOWS_TTL_MS;
  useEffect(() => {
    if (!hydrated || fresh) return;
    const { from, to } = horizon();
    Promise.all([api.windows(from, to), api.longWeekends(from, to)]).then(([w, lw]) => {
      setWindows(w.data, lw.data, w.mode === "live" && lw.mode === "live" ? "live" : "fixture");
    });
  }, [hydrated, fresh, setWindows]);
  return { windows, longWeekends, loading: !windows.length && !longWeekends.length };
}

export function bridgeFor(w: FreeWindow, radar: BridgeWindow[]): BridgeWindow | undefined {
  return radar.find((b) => b.window.start === w.start && b.window.end === w.end);
}
