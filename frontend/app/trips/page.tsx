"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Bell, Check, ChevronDown, ChevronRight, Plane, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatOrigins } from "@/lib/airports";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { PartyPicker, priceText } from "@/components/money";
import { moneyOf } from "@/lib/money";
import { PrioritySlider } from "@/components/priority-slider";
import { RecCard } from "@/components/rec-card";
import { Chip, InfoTip } from "@/components/declutter";
import { TripLoader, type Stage } from "@/components/trip-loader";
import {
  HiddenTrips,
  PendingRanking,
  RowActions,
  SwipeRow,
  SwipeToast,
  useHiddenIds,
  useRowSwipes,
  useUndoShortcut,
} from "@/components/trips-swipe";
import { shownRows, useSwipeSession } from "@/lib/swipe-session";
import { commitLearning } from "@/lib/use-reactions";
import { budgetBanner, overBudget, withinBudgetFirst } from "@/lib/budget";
import { PickedDatesEmpty, PickedDatesHeader, useClientToday } from "@/components/date-picker/free-dates-planner";
import { AppShell, PageTitle } from "@/components/shell";
import { PersonaCard } from "@/components/persona-card";
import { useT } from "@/lib/i18n";
import { useTrip } from "@/lib/store";
import type { RankedRecommendation } from "@/lib/types";
import { bridgeFor, useWindows } from "@/lib/windows";
import { useRecommendations } from "@/lib/use-recommendations";
import { listedTrips } from "@/lib/trip-list";

/** The proactive moment: a push-style card the scan would send. */
function PushBanner({ rec, onClose }: { rec: RankedRecommendation; onClose: () => void }) {
  const { t, fmt } = useT();
  const tp = t.trips.push;
  // A floating toast must never park over the page title: it leaves on its own after 3 s
  // (timer starts once; parent re-renders don't restart it).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const timer = setTimeout(() => close.current(), 3_600); // 0.6 s entrance delay + 3 s visible
    return () => clearTimeout(timer);
  }, []);
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
          {tp.body(priceText(rec, t, fmt), fmt.pln(rec.flight_cost_pln), Math.round(rec.score.total * 100))}
        </p>
      </Link>
    </motion.div>
  );
}

function Trips() {
  const params = useSearchParams();
  const windowFilter = params.get("window");
  const { t, fmt, lang } = useT();
  const tt = t.trips;
  const sw = t.swipeOffers;
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
  // T23: one ranked list whose rows are swipeable (right = "Chcę tam", left = "Nie dla mnie" with undo,
  // heart = "Super!"). A row swiped left collapses at once (`hiding`) and stays out once the log has it.
  const hiding = useSwipeSession((s) => s.hiding);
  const { swipe, undo, canUndo } = useRowSwipes();
  useUndoShortcut(undo);
  // Leaving /trips applies what the swipes taught us (one re-rank) and ends the swipe session.
  const resetSwipes = useSwipeSession((s) => s.reset);
  useEffect(
    () => () => {
      commitLearning();
      resetSwipes();
    },
    [resetSwipes],
  );
  const list = matching.filter((r) => !hidden.has(r.id) && !hiding.includes(r.id));
  const budget = (profile ?? DEMO_PROFILE).budget_pln;
  const [withinFirst, setWithinFirst] = useState(false);
  // the same selector as the home "#1" (lib/trip-list.ts), so the two can't disagree
  const today = useClientToday();
  const ranks = listedTrips(matching, hidden, today);
  const fitting = withinFirst ? withinBudgetFirst(ranks, budget) : ranks;
  // the rows drawn: a "Not for me" collapses at once, before the backend answers (and comes back if it
  // fails). Ranks and the selector above stay untouched, so home #1 = /trips #1 still holds.
  const rows = shownRows(fitting, hiding);
  // Never let an over-budget trip sit at #1 without saying so (cheapest/fit counts come from every trip).
  const banner = budgetBanner(fitting, budget, list);
  const notMyStyle = list.filter((r) => r.fit?.label === "poor_fit");
  const [showPoor, setShowPoor] = useState(false);
  // Top picks that all share one window read like a bug; explain it (and only blame fixtures in fixture mode).
  const top3 = fitting.slice(0, 3);
  const sameDates =
    !windowFilter && top3.length >= 2 && top3.every((r) => r.window.start === top3[0].window.start && r.window.end === top3[0].window.end);
  const fixtureRecs = useTrip((s) => s.modes.recs) === "fixture";
  // Like the notifier (T5b, #29): only push a good or great fit, and only on an exact price.
  const top = refining
    ? undefined
    : ranked.find((r) => moneyOf(r).status === "exact" && (!r.fit || r.fit.label === "great_fit" || r.fit.label === "good_fit"));

  // Phase 2 landed: a floating 2 s confirmation, shown once. Refining/landed float above the
  // bottom nav instead of taking a slot in the page, so the cards never jump.
  const wasRefining = useRef(false);
  const [landed, setLanded] = useState(false);
  const [landedToast, setLandedToast] = useState(false);
  useEffect(() => {
    const justLanded = wasRefining.current && !refining;
    wasRefining.current = refining;
    if (!justLanded) return;
    const on = setTimeout(() => {
      setLanded(true);
      setLandedToast(true);
    }, 0);
    const off = setTimeout(() => setLandedToast(false), 2_000);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [refining]);
  const liveData = mode === "live";

  const origin = (profile ?? DEMO_PROFILE).origin_airports.join("/");
  const windowCount = windows.length + longWeekends.length;
  // Only real signals get a ✓ (the windows actually loaded). The rest describes what the
  // pipeline is doing until the response replaces the loader.
  const stages: Stage[] = [
    windowCount ? { label: tt.loader.foundWindows(windowCount), done: true } : { label: tt.loader.findingWindows },
    { label: tt.loader.scanning(formatOrigins((profile ?? DEMO_PROFILE).origin_airports, lang)) },
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

      <PageTitle title={tt.title} />

      {/* T19: the Travel DNA result as a compact card, not a stop before this list (full view in Profile) */}
      <PersonaCard className="mb-3" />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* The limit is optional and off by default (BUDGET.md): no chip unless one is set. */}
        {budget != null && (
          <Link
            href="/profile"
            aria-label={tt.budget.editAria}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-ink-soft shadow-soft hover:border-pine/40"
          >
            <Wallet className="size-4 text-pine" aria-hidden />
            {tt.budget.label} <b className="tabular font-semibold text-ink">{fmt.pln(budget)}</b>
            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
          </Link>
        )}
        {/* Top picks sharing one window: say which, link to the others (not a paragraph). */}
        {sameDates && (
          <span className="inline-flex items-center">
            <Link href="/windows" className="hover:opacity-80">
              <Chip className="py-1.5 text-sm">
                📅 {fmt.range(fitting[0].window)} · {tt.sameDates.otherDates} ›
              </Chip>
            </Link>
            {fixtureRecs && <InfoTip>{tt.sameDates.fixtureNote}</InfoTip>}
          </span>
        )}
      </div>

      <PickedDatesHeader />

      <PrioritySlider value={slider} weights={weights} onChange={setSlider} />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <PartyPicker compact />
      </div>

      {windowFilter && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-pine-soft px-3 py-2 text-sm text-pine-deep">
          {tt.filter.showingOnly(fmt.range({ start: wStart, end: wEnd }))}
          <Link href="/trips" className="font-medium underline-offset-2 hover:underline">
            {tt.filter.showAll}
          </Link>
        </div>
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

      <AnimatePresence>
        {((refining && list.length > 0) || landedToast) && (
          <motion.p
            key={refining ? "refining" : "landed"}
            aria-hidden
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={cn(
              "fixed inset-x-0 bottom-20 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium shadow-lift",
              refining ? "sheen border border-pine/20 bg-pine-soft text-pine-deep" : "bg-pine text-paper",
            )}
          >
            {refining ? <Plane className="size-4 motion-safe:animate-pulse" /> : <Check className="size-4" />}
            {refining
              ? liveData
                ? tt.refining.titleLive
                : tt.refining.titleDemo
              : liveData
                ? tt.refining.landedLive
                : tt.refining.landedDemo}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-5 space-y-3 empty:hidden">

        {banner && (
          <div role="note" className="flex gap-2.5 rounded-2xl border border-clay/30 bg-clay-soft px-3.5 py-2.5 text-sm leading-snug text-ink">
            <Wallet className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
            {banner.kind === "none_fit" ? (
              <p>
                <b>{tt.budget.noneFitTitle(fmt.pln(banner.budget))}</b>{" "}
                {tt.budget.noneFitBody(banner.cheapest.city, priceText(banner.cheapest, t, fmt), fmt.pln(banner.over))}
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
                <b>{tt.budget.topOverTitle(fmt.pln(banner.over))}</b> {tt.budget.fitsHidden(banner.hiddenCount)}{" "}
                <button onClick={() => setShowPoor(true)} className="font-semibold text-pine underline-offset-2 hover:underline">
                  {tt.notYourStyle}
                </button>
                .
              </p>
            ) : (
              <p>
                <b>{tt.budget.topOverTitle(fmt.pln(banner.over))}</b> {tt.budget.topOverBody(banner.withinCount)}{" "}
                <button onClick={() => setWithinFirst(true)} className="font-semibold text-pine underline-offset-2 hover:underline">
                  {tt.budget.showThoseFirst}
                </button>
              </p>
            )}
          </div>
        )}
        {withinFirst && !banner && (
          <p className="flex items-center justify-between rounded-xl bg-paper-deep px-3 py-2 text-sm text-ink-soft">
            {tt.budget.withinFirst}
            <button onClick={() => setWithinFirst(false)} className="font-medium text-pine underline-offset-2 hover:underline">
              {tt.budget.backToRanking}
            </button>
          </p>
        )}
      </div>

      {/* page-level: a ranking update never drops "Learned: …" / "Undone" (#49) */}
      <SwipeToast onUndo={undo} canUndo={canUndo} />
      <p id="swipe-hint" hidden>{sw.hint}</p>
      <LayoutGroup>
        <ul className="mt-4 space-y-4" aria-busy={loading || refining} aria-describedby="swipe-hint">
          <AnimatePresence initial={false}>
            {rows.map((rec, i) => (
              <motion.li
                key={rec.id}
                layout
                transition={{ type: "spring", stiffness: 200, damping: 28 }}
                // a row swiped "Nie dla mnie" collapses out; Undo brings it back in place
                exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.22 } }}
              >
                <SwipeRow rec={rec} onReact={swipe} tour={i === 0 ? "swipe-row" : undefined}>
                  <RecCard
                    rec={rec}
                    featured={i === 0}
                    bridge={bridgeFor(rec.window, longWeekends)}
                    refining={refining}
                    overBudgetPln={overBudget(rec, budget)}
                    weights={weights}
                    actions={<RowActions rec={rec} onReact={swipe} />}
                  />
                </SwipeRow>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <PendingRanking />

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
                        weights={weights}
                      />
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </LayoutGroup>
      <HiddenTrips />
      {!loading && !list.length && (
        <PickedDatesEmpty>
          <p className="mt-6 text-center text-sm text-muted-foreground">{tt.empty}</p>
        </PickedDatesEmpty>
      )}
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
