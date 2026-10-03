"use client";

import { useEffect, useMemo, useRef } from "react";
import { api } from "./api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { rerank } from "./scoring";
import { useHydrated, useTrip } from "./store";

/**
 * Recommendations ranked under the current weights. Ranking reacts instantly
 * (local re-weighting of backend factor scores); in live mode the backend is
 * re-queried after the slider settles so it stays the source of truth.
 */
export function useRecommendations() {
  const hydrated = useHydrated();
  const { profile, weights, recs, setRecs, setMode, mode } = useTrip();
  const first = useRef(true);

  useEffect(() => {
    if (!hydrated || recs.length) return;
    let alive = true;
    api.recommendations({ profile: profile ?? DEMO_PROFILE, weights }).then(({ data, mode }) => {
      if (!alive) return;
      setRecs(data);
      setMode(mode);
    });
    return () => {
      alive = false;
    };
    // weights intentionally excluded: slider moves are handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, recs.length, profile]);

  useEffect(() => {
    if (first.current || mode !== "live") {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      api.recommendations({ profile: profile ?? DEMO_PROFILE, weights }).then(({ data, mode }) => {
        if (mode === "live") setRecs(data);
      });
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights]);

  const ranked = useMemo(() => rerank(recs, weights), [recs, weights]);
  return { ranked, loading: !recs.length, weights };
}
