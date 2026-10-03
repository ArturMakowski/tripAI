"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Bell, CalendarDays, Check, ChevronDown, Wallet, X } from "lucide-react";
import { overallOutOfFive } from "@/lib/stars";
import { cn } from "@/lib/utils";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { PrioritySlider } from "@/components/priority-slider";
import { RecCard } from "@/components/rec-card";
import { RefiningStrip, TripLoader, type Stage } from "@/components/trip-loader";
import { HiddenTrips, SwipeMode, TripsViewToggle, useHiddenIds } from "@/components/trips-swipe";
import { useSwipe } from "@/lib/use-reactions";
import { budgetBanner, overBudget, withinBudgetFirst } from "@/lib/budget";
import { PickedDatesEmpty, PickedDatesHeader } from "@/components/date-picker/free-dates-planner";
import { AppShell, PageTitle } from "@/components/shell";
import { useT } from "@/lib/i18n";
import { useTrip } from "@/lib/store";
import type { RankedRecommendation } from "@/lib/types";
import { bridgeFor, useWindows } from "@/lib/windows";
import { useRecommendations } from "@/lib/use-recommendations";

/** The proactive moment: a push-style card the scan would send. */
function PushBanner({ rec, onClose }: { rec: RankedRecommendation; onClose: () => void }) {
  const { t, fmt } = useT();
  const tp = t.trips.push;
  return (
    <motion.div
      initial={{ y: -40, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 24, delay: 0.6 }}
      // Floating toast: it arrives only with final prices, so it must not push the cards around.
      className="fixed inset-x-0 top-16 z-40 mx-auto w-[calc(100%-2rem)] max-w-[408px] rounded-2xl border border-line bg-card/95 p-3.5 shadow-lift backdrop-blur"
      role="status"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid size-5 place-items-center rounded-md bg-pine">
          <Bell className="size-3 text-paper" />
        </span>
        <span className="font-semibold tracking-wide text-ink-soft uppercase">TripAI</span>
        <span>{tp.now}</span>
        <button onClick={onClose} className="ml-auto rounded-full p-1 hover:bg-paper-deep" aria-label={tp.dismiss}>
          <X className="size-3.5" />
        </button>
      </div>
      <Link href={`/trips/${rec.id}`} className="mt-1.5 block">
        <p className="text-[15px] leading-snug font-semibold text-ink">
          {tp.title(fmt.range(rec.window), rec.city)}
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {tp.body(fmt.pln(rec.total_cost_pln), fmt.pln(rec.flight_cost_pln), fmt.num(overallOutOfFive(rec.score.total), 1))}
        </p>
      </Link>
    </motion.div>
  );
}

function Trips() {
  const params = useSearchParams();
  const windowFilter = params.get("window");
  const { t, fmt } = useT();
  const tt = t.trips;
  const { ranked, loading, refining, phased, mode, weights } = useRecommendations();
  const slider = useTrip((s) => s.slider);
  const setSlider = useTrip((s) => s.setSlider);
  const [dismissed, setDismissed] = useState(false);
  const { windows, longWeekends } = useWindows();

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
      .then(({ data, mode }) => {
        const known = new Set(recs.map((r) => r.id));
        setRecs([...recs, ...data.filter((r) => !known.has(r.id))], { profile, weights, mode, merge: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowFilter, loading, matching.length]);
  // T6: city+dates swiped "Nie dla mnie" are hidden (listed under "Hidden" below)
  const hidden = useHiddenIds();
  const view = useSwipe((s) => s.view);
  const list = matching.filter((r) => !hidden.has(r.id));
  const budget = (profile ?? DEMO_PROFILE).budget_pln;
  const [withinFirst, setWithinFirst] = useState(false);
  const ranks = list.filter((r) => r.fit?.label !== "poor_fit");
  const fitting = withinFirst ? withinBudgetFirst(ranks, budget) : ranks;
  // Never let an over-budget trip sit at #1 without saying so (cheapest/fit counts come from every trip).
  const banner = budgetBanner(fitting, budget, list);
  const notMyStyle = list.filter((r) => r.fit?.label === "poor_fit");
  const [showPoor, setShowPoor] = useState(false);
  // Top picks that all share one window read like a bug; explain it (and only blame fixtures in fixture mode).
  const top3 = fitting.slice(0, 3);
  const sameDates =
    !windowFilter && top3.length >= 2 && top3.every((r) => r.window.start === top3[0].window.start && r.window.end === top3[0].window.end);
  const fixtureRecs = useTrip((s) => s.modes.recs) === "fixture";
  // Like the notifier (T5b): only push a good or great fit.
  const top = refining ? undefined : ranked.find((r) => !r.fit || r.fit.label === "great_fit" || r.fit.label === "good_fit");

  // Phase 2 landed: the status slot switches from "refining" to a confirmation that stays put
  // (same height, so the cards never jump).
  const wasRefining = useRef(false);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const justLanded = wasRefining.current && !refining;
    wasRefining.current = refining;
    if (!justLanded) return;
    const t = setTimeout(() => setLanded(true), 0);
    return () => clearTimeout(t);
  }, [refining]);
  const liveData = mode === "live";

  const origin = (profile ?? DEMO_PROFILE).origin_airports.join("/");
  const windowCount = windows.length + longWeekends.length;
  // Only real signals get a ✓ (the windows actually loaded). The rest describes what the
  // pipeline is doing until the response replaces the loader.
  const stages: Stage[] = [
    windowCount ? { label: tt.loader.foundWindows(windowCount), done: true } : { label: tt.loader.findingWindows },
    { label: tt.loader.scanning(origin) },
    ...(phased === false
      ? [{ label: tt.loader.flightsHotels }, { label: tt.loader.weatherRanking }]
      : [{ label: tt.loader.cachedFlights }]),
  ];
  const announce = loading
    ? tt.announce.loading
    : refining
      ? tt.announce.refining
      : landed
        ? liveData
          ? tt.announce.landedLive
          : tt.announce.landedDemo
        : "";

  return (
    <AppShell>
      <AnimatePresence>{!dismissed && top && !windowFilter && <PushBanner rec={top} onClose={() => setDismissed(true)} />}</AnimatePresence>

      <PageTitle eyebrow={tt.eyebrow} title={tt.title}>
        {tt.intro}
      </PageTitle>

      <Link
        href="/profile"
        className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-ink-soft shadow-soft hover:border-pine/40"
      >
        <Wallet className="size-4 text-pine" aria-hidden />
        {budget != null ? (
          <>
            {tt.budget.label} <b className="tabular font-semibold text-ink">{fmt.pln(budget)}</b>
          </>
        ) : (
          <>{tt.budget.none}</>
        )}
        <span className="text-muted-foreground">· {budget != null ? tt.budget.setInProfile : tt.budget.setOne}</span>
      </Link>

      <PickedDatesHeader />

      <PrioritySlider value={slider} weights={weights} onChange={setSlider} />
      <TripsViewToggle className="mt-4" />

      {windowFilter && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-pine-soft px-3 py-2 text-sm text-pine-deep">
          {tt.filter.showingOnly(fmt.range({ start: wStart, end: wEnd }))}
          <Link href="/trips" className="font-medium underline-offset-2 hover:underline">
            {tt.filter.showAll}
          </Link>
        </div>
      )}

      {sameDates && (
        <p role="note" className="mt-4 flex gap-2 rounded-xl bg-sky-soft px-3 py-2.5 text-sm leading-snug text-ink">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-sky" aria-hidden />
          {fixtureRecs ? (
            <span>
              {tt.sameDates.fixturePre} <b>{fmt.range(fitting[0].window)}</b> {tt.sameDates.fixturePost}
            </span>
          ) : (
            <span>
              {tt.sameDates.livePre} <b>{fmt.range(fitting[0].window)}</b>
              {tt.sameDates.livePost}{" "}
              <Link href="/windows" className="font-medium text-pine underline-offset-2 hover:underline">
                {tt.sameDates.freeTime}
              </Link>
              .
            </span>
          )}
        </p>
      )}

      {loading && !list.length && (
        <div className="mt-5">
          <TripLoader
            origin={origin}
            title={tt.loader.title}
            stages={stages}
            upNext={phased === false ? undefined : tt.loader.upNext}
          />
        </div>
      )}

      {/* One persistent live region for screen readers; the visual strips below are aria-hidden. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <div className="mt-5 space-y-3 empty:hidden">
        {(refining || landed) && list.length > 0 && (
          <div className="relative h-[58px]">
            <AnimatePresence mode="wait" initial={false}>
              {refining ? (
                <motion.div key="refining" className="absolute inset-0" exit={{ opacity: 0 }}>
                  <RefiningStrip
                    title={liveData ? tt.refining.titleLive : tt.refining.titleDemo}
                    detail={tt.refining.detail}
                    tag={tt.refining.tag}
                  />
                </motion.div>
              ) : (
                <motion.p
                  key="landed"
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 flex items-center gap-2 rounded-2xl bg-pine px-3.5 text-sm font-medium text-paper"
                >
                  <Check className="size-4" />
                  {liveData ? tt.refining.landedLive : tt.refining.landedDemo}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        {banner && view === "list" && (
          <div role="note" className="flex gap-2.5 rounded-2xl border border-clay/30 bg-clay-soft p-3.5 text-sm leading-snug text-ink">
            <Wallet className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
            {banner.kind === "none_fit" ? (
              <p>
                <b>{tt.budget.noneFitTitle(fmt.pln(banner.budget))}</b>{" "}
                {tt.budget.noneFitBody(banner.cheapest.city, fmt.pln(banner.cheapest.total_cost_pln), fmt.pln(banner.over))}
                {!fitting.some((r) => r.id === banner.cheapest.id) && (
                  <>
                    , {tt.budget.listedUnder}{" "}
                    <button onClick={() => setShowPoor(true)} className="font-semibold text-pine underline-offset-2 hover:underline">
                      {tt.notYourStyle}
                    </button>
                  </>
                )}
                .
              </p>
            ) : banner.kind === "fits_hidden" ? (
              <p>
                <b>{tt.budget.topOverTitle(fmt.pln(banner.over), fmt.pln(banner.budget))}</b> {tt.budget.fitsHidden(banner.hiddenCount)}{" "}
                <button onClick={() => setShowPoor(true)} className="font-semibold text-pine underline-offset-2 hover:underline">
                  {tt.notYourStyle}
                </button>
                .
              </p>
            ) : (
              <p>
                <b>{tt.budget.topOverTitle(fmt.pln(banner.over), fmt.pln(banner.budget))}</b> {tt.budget.topOverBody(banner.withinCount)}{" "}
                <button onClick={() => setWithinFirst(true)} className="font-semibold text-pine underline-offset-2 hover:underline">
                  {tt.budget.showThoseFirst}
                </button>
              </p>
            )}
          </div>
        )}
        {withinFirst && !banner && view === "list" && (
          <p className="flex items-center justify-between rounded-xl bg-paper-deep px-3 py-2 text-sm text-ink-soft">
            {tt.budget.withinFirst}
            <button onClick={() => setWithinFirst(false)} className="font-medium text-pine underline-offset-2 hover:underline">
              {tt.budget.backToRanking}
            </button>
          </p>
        )}
      </div>

      {view === "swipe" && list.length > 0 && <SwipeMode ranked={list} refining={refining} />}
      {/* list mode (inner block kept at its old indentation to keep this diff small) */}
      {view === "list" && (
      <LayoutGroup>
        <ul className="mt-4 space-y-4" aria-busy={loading || refining}>
          {fitting.map((rec, i) => (
            <motion.li key={rec.id} layout transition={{ type: "spring", stiffness: 200, damping: 28 }}>
              <RecCard
                rec={rec}
                featured={i === 0}
                bridge={bridgeFor(rec.window, longWeekends)}
                refining={refining}
                overBudgetPln={overBudget(rec, budget)}
              />
            </motion.li>
          ))}
        </ul>

        {/* Never hidden silently: poor fits stay one tap away, with the reason on each card. */}
        {notMyStyle.length > 0 && (
          <motion.div layout className="mt-6">
            <button
              onClick={() => setShowPoor((v) => !v)}
              aria-expanded={showPoor}
              className="flex w-full items-center justify-between rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-soft hover:border-clay/40"
            >
              <span>
                <b className="font-semibold text-ink">{tt.notYourStyle}</b> · {tt.notYourStyleCount(notMyStyle.length)} (
                {showPoor ? tt.hide : tt.showAnyway})
              </span>
              <ChevronDown className={cn("size-4 transition-transform", showPoor && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {showPoor && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-4 overflow-hidden pt-4"
                >
                  {notMyStyle.map((rec) => (
                    <li key={rec.id} className="opacity-90 saturate-[0.85]">
                      <RecCard
                        rec={rec}
                        bridge={bridgeFor(rec.window, longWeekends)}
                        refining={refining}
                        overBudgetPln={overBudget(rec, budget)}
                      />
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </LayoutGroup>
      )}
      {view === "list" && <HiddenTrips />}
      {!loading && !list.length && (
        <PickedDatesEmpty>
          <p className="mt-6 text-center text-sm text-muted-foreground">{tt.empty}</p>
        </PickedDatesEmpty>
      )}
      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        {tt.neverPaid}
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
