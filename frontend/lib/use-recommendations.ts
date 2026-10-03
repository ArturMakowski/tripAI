"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useLang, type Lang } from "./i18n";
import { DEMO_PROFILE } from "./mock/fixtures";
import { normalise } from "./scoring";
import { rankedView } from "./trip-list";
import { profileKey, RECS_TTL_MS, useHydrated, useTrip } from "./store";
import type { Weights } from "./types";
import { datesChanged, pickedWindows, useDates } from "./windows-store";

export function sameWeights(a: Weights | undefined | null, b: Weights | undefined | null): boolean {
  if (!a || !b) return false;
  const x = normalise(a);
  const y = normalise(b);
  return (["price", "weather", "crowds", "taste"] as const).every((f) => Math.abs(x[f] - y[f]) < 0.005);
}

/**
 * Cached recs are reusable only for the same profile and UI language, within the TTL. The language
 * matters because the backend's "why", evidence labels, flip text and fit verdicts are written in it:
 * switching PL/EN must refetch, not show the old language until the cache expires.
 */
export function isFresh(
  meta: { at: number; profileKey: string; lang?: Lang } | null,
  want: { profileKey: string; lang: Lang; now: number },
): boolean {
  return !!meta && meta.profileKey === want.profileKey && meta.lang === want.lang && want.now - meta.at < RECS_TTL_MS;
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
  // Picked dates (T4f): an edit refetches even while a request is in flight (that one is dropped).
  const pickedRanges = useDates((s) => s.ranges);
  const pickedFlex = useDates((s) => s.flexDays);

  const lang = useLang();
  // An empty answer is still an answer: show the empty state instead of loading forever.
  const fresh = isFresh(recsMeta, { profileKey: profileKey(profile), lang, now }) && !datesChanged();
  // Receipts (flip hint, counterfactual score deltas, hash) were computed at these weights.
  const scoredAtCurrentWeights = sameWeights(recsMeta?.weights, weights);

  // Fast results are on screen, exact live prices still coming.
  const refining = fresh && recsMeta?.phase === "fast";

  // Initial / stale load. Two-phase only when the backend says it supports it (/health.phases);
  // otherwise, or if the fast call fails, exactly one classic call (with explanations), as before.
  const [phased, setPhased] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hydrated || fresh) return;
    const id = ++seq.current;
    const ctrl = new AbortController();
    const req = { profile: profile ?? DEMO_PROFILE, weights, ...pickedWindows() };
    const single = () =>
      api.recommendations(req, ctrl.signal).then(({ data, mode }) => {
        if (id === seq.current && !datesChanged()) setRecs(data, { profile, weights, mode, phase: "full" });
      });
    api.capabilities().then(({ phases }) => {
      if (id !== seq.current) return;
      setPhased(phases);
      if (!phases) return single();
      return api
        .recommendationsPhase(req, "fast", ctrl.signal)
        .then(({ data, mode }) => {
          if (id === seq.current && !datesChanged()) setRecs(data, { profile, weights, mode, phase: "fast" });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) return single();
        });
    });
    return () => ctrl.abort();
    // weights intentionally excluded: slider moves are handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, fresh, profile, pickedRanges, pickedFlex]);

  // Phase 2: exact live prices + explanations; cards update and re-order in place.
  // If it fails, the fast list stays (marked final) rather than swapping in fixtures.
  useEffect(() => {
    if (!hydrated || !refining) return;
    const id = ++seq.current;
    const ctrl = new AbortController();
    const current = () => useTrip.getState().recs;
    api
      .recommendationsPhase({ profile: profile ?? DEMO_PROFILE, weights, ...pickedWindows() }, "full", ctrl.signal)
      .then(({ data, mode }) => {
        if (id === seq.current && !datesChanged()) setRecs(data, { profile, weights, mode, phase: "full" });
      })
      .catch(() => {
        if (!ctrl.signal.aborted && id === seq.current)
          setRecs(current(), { profile, weights, mode: useTrip.getState().modes.recs ?? "live", phase: "full", merge: false });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, refining]);

  // Slider settled with different weights: refresh receipts (no new LLM calls; keep existing "why").
  useEffect(() => {
    if (!hydrated || !fresh || refining || modes.recs !== "live" || scoredAtCurrentWeights) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const id = ++seq.current;
      api.recommendations({ profile: profile ?? DEMO_PROFILE, weights, explain_top: 0, ...pickedWindows() }, ctrl.signal).then(({ data, mode }) => {
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
  const fitProfile = profile ?? DEMO_PROFILE;
  const fitLang = lang; // on-device rule verdicts are written in the UI language
  const ranked = useMemo(
    () => rankedView(recs, weights, { fixture, profile: fitProfile, lang: fitLang }),
    [recs, weights, fixture, fitProfile, fitLang],
  );
  return {
    ranked,
    loading: !fresh,
    refining,
    /** null until known; false = classic single call (backend without phase support) */
    phased,
    mode: modes.recs ?? null,
    weights,
    scoredAtCurrentWeights: fixture || scoredAtCurrentWeights,
  };
}
