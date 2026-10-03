"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { withReceipts } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { normalise, rerank } from "./scoring";
import { profileKey, RECS_TTL_MS, useHydrated, useTrip } from "./store";
import type { Weights } from "./types";

export function sameWeights(a: Weights | undefined | null, b: Weights | undefined | null): boolean {
  if (!a || !b) return false;
  const x = normalise(a);
  const y = normalise(b);
  return (["price", "weather", "crowds", "taste"] as const).every((f) => Math.abs(x[f] - y[f]) < 0.005);
}

/**
 * Recommendations ranked under the current weights. Ranking reacts instantly
 * (local re-weighting of backend factor scores, same formula as tripai.scoring);
 * in live mode the backend is re-queried once the slider settles so receipts
 * (flip, counterfactuals, hash) match the weights on screen.
 */
export function useRecommendations() {
  const hydrated = useHydrated();
  const { profile, weights, recs, recsMeta, setRecs, modes } = useTrip();
  const seq = useRef(0);
  const [now] = useState(() => Date.now()); // staleness is judged once per mount

  const fresh =
    !!recsMeta && recsMeta.profileKey === profileKey(profile) && now - recsMeta.at < RECS_TTL_MS && recs.length > 0;
  // Receipts (flip hint, counterfactual score deltas, hash) were computed at these weights.
  const scoredAtCurrentWeights = sameWeights(recsMeta?.weights, weights);

  // Initial / stale load (with LLM explanations for the top 3).
  useEffect(() => {
    if (!hydrated || fresh) return;
    const id = ++seq.current;
    const ctrl = new AbortController();
    const p = profile ?? DEMO_PROFILE;
    api.recommendations({ profile: p, weights }, ctrl.signal).then(({ data, mode }) => {
      if (id === seq.current) setRecs(data, { profile, weights, mode });
    });
    return () => ctrl.abort();
    // weights intentionally excluded: slider moves are handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, fresh, profile]);

  // Slider settled with different weights: refresh receipts (no new LLM calls; keep existing "why").
  useEffect(() => {
    if (!hydrated || !fresh || modes.recs !== "live" || scoredAtCurrentWeights) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const id = ++seq.current;
      api.recommendations({ profile: profile ?? DEMO_PROFILE, weights, explain_top: 0 }, ctrl.signal).then(({ data, mode }) => {
        if (id !== seq.current || mode !== "live") return; // a newer request won, or backend dropped out
        const whyById = new Map(useTrip.getState().recs.map((r) => [r.id, r.why]));
        setRecs(
          data.map((r) => ({ ...r, why: whyById.get(r.id) ?? r.why })),
          { profile, weights, mode },
        );
      });
    }, 700);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, fresh, weights, scoredAtCurrentWeights]);

  // Fixture data has no backend to ask, so recompute the rank-dependent receipt parts locally.
  const fixture = modes.recs === "fixture";
  const ranked = useMemo(() => (fixture ? withReceipts(rerank(recs, weights), weights) : rerank(recs, weights)), [recs, weights, fixture]);
  return { ranked, loading: !recs.length, weights, scoredAtCurrentWeights: fixture || scoredAtCurrentWeights };
}
