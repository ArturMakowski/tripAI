"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Bell, X } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { PrioritySlider } from "@/components/priority-slider";
import { RecCard } from "@/components/rec-card";
import { AppShell, PageTitle } from "@/components/shell";
import { formatPLN, formatRange, pct } from "@/lib/format";
import { useTrip } from "@/lib/store";
import type { RankedRecommendation } from "@/lib/types";
import { bridgeFor, useWindows } from "@/lib/windows";
import { useRecommendations } from "@/lib/use-recommendations";

/** The proactive moment: a push-style card the scan would send. */
function PushBanner({ rec, onClose }: { rec: RankedRecommendation; onClose: () => void }) {
  return (
    <motion.div
      initial={{ y: -40, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 24, delay: 0.6 }}
      className="relative mb-5 rounded-2xl border border-line bg-card/95 p-3.5 shadow-lift backdrop-blur"
      role="status"
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="grid size-5 place-items-center rounded-md bg-pine">
          <Bell className="size-3 text-paper" />
        </span>
        <span className="font-semibold tracking-wide text-ink-soft uppercase">TripAI</span>
        <span>· now</span>
        <button onClick={onClose} className="ml-auto rounded-full p-1 hover:bg-paper-deep" aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      </div>
      <Link href={`/trips/${rec.id}`} className="mt-1.5 block">
        <p className="text-[15px] leading-snug font-semibold text-ink">
          You&rsquo;re free {formatRange(rec.window)} → {rec.city}
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {formatPLN(rec.total_cost_pln)} all-in · flights {formatPLN(rec.flight_cost_pln)} · score {pct(rec.score.total)}. Tap
          to see why.
        </p>
      </Link>
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-line bg-card">
      <div className="h-44 animate-pulse bg-paper-deep" />
      <div className="space-y-2 p-4">
        <div className="h-5 w-1/2 animate-pulse rounded bg-paper-deep" />
        <div className="h-3 w-full animate-pulse rounded bg-paper-deep" />
      </div>
    </div>
  );
}

function Trips() {
  const params = useSearchParams();
  const windowFilter = params.get("window");
  const { ranked, loading, weights } = useRecommendations();
  const slider = useTrip((s) => s.slider);
  const setSlider = useTrip((s) => s.setSlider);
  const [dismissed, setDismissed] = useState(false);
  const { longWeekends } = useWindows();

  const [wStart, wEnd = wStart] = windowFilter?.split("_") ?? [];
  // the backend splits long windows into trip-length sub-windows, so match on overlap
  const matching = windowFilter ? ranked.filter((r) => r.window.start <= wEnd && r.window.end >= wStart) : ranked;
  // Nothing cached for this window (e.g. beyond the default horizon): ask the scorer for it
  // directly and merge into the ranking, so the receipt links keep working.
  const profile = useTrip((s) => s.profile);
  const recs = useTrip((s) => s.recs);
  const setRecs = useTrip((s) => s.setRecs);
  useEffect(() => {
    if (!windowFilter || loading || matching.length) return;
    api
      .recommendations({ profile: profile ?? DEMO_PROFILE, weights, windows: [{ start: wStart, end: wEnd, source: "manual" }] })
      .then(({ data }) => {
        const known = new Set(recs.map((r) => r.id));
        setRecs([...recs, ...data.filter((r) => !known.has(r.id))]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowFilter, loading, matching.length]);
  const list = matching;
  const top = ranked[0];

  return (
    <AppShell>
      <AnimatePresence>{!dismissed && top && !windowFilter && <PushBanner rec={top} onClose={() => setDismissed(true)} />}</AnimatePresence>

      <PageTitle eyebrow="Picked for your free time" title={<>Where &amp; when, ranked.</>}>
        Every score is a weighted sum of four sourced factors. Move the slider and the ranking updates as you drag.
      </PageTitle>

      <PrioritySlider value={slider} weights={weights} onChange={setSlider} />

      {windowFilter && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-pine-soft px-3 py-2 text-sm text-pine-deep">
          Showing {formatRange({ start: wStart, end: wEnd })} only
          <Link href="/trips" className="font-medium underline-offset-2 hover:underline">
            Show all
          </Link>
        </div>
      )}

      <LayoutGroup>
        <ul className="mt-5 space-y-4">
          {loading && !list.length && [0, 1].map((i) => <SkeletonCard key={i} />)}
          {list.map((rec, i) => (
            <motion.li key={rec.id} layout transition={{ type: "spring", stiffness: 260, damping: 30 }}>
              <RecCard rec={rec} weights={weights} featured={i === 0} bridge={bridgeFor(rec.window, longWeekends)} />
            </motion.li>
          ))}
        </ul>
      </LayoutGroup>
      {!loading && !list.length && (
        <p className="mt-6 text-center text-sm text-muted-foreground">No trips fit this window yet. We&rsquo;ll keep watching.</p>
      )}
      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        Rankings are never paid for. Sponsored offers, if we ever show any, will be labelled separately.
      </p>
    </AppShell>
  );
}

export default function TripsPage() {
  return (
    <Suspense>
      <Trips />
    </Suspense>
  );
}
