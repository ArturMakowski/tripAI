"use client";

import Link from "next/link";
import { CalendarHeart, ChevronRight, Luggage } from "lucide-react";
import { useMemo } from "react";
import { PriceInline } from "@/components/money";
import { CityPhoto } from "@/components/rec-card";
import { useClientToday } from "@/components/date-picker/free-dates-planner";
import { formatDates } from "@/components/date-picker/date-range-calendar";
import { nextFreeWindow, type NextWindow } from "@/lib/home-today";
import { useLang, useT } from "@/lib/i18n";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { moneyOf } from "@/lib/money";
import { useHydrated, useTrip } from "@/lib/store";
import { rankedView, topTrip } from "@/lib/trip-list";
import type { RankedRecommendation } from "@/lib/types";
import { hiddenIds, useSwipe } from "@/lib/use-reactions";
import { useDates } from "@/lib/windows-store";
import { cn } from "@/lib/utils";

const card = "group flex items-center gap-3 rounded-2xl border border-line bg-card shadow-soft transition-shadow hover:shadow-lift";
// two text styles per card (docs/DECLUTTER.md): a small line and a display line
const small = "truncate text-[13px] text-ink-soft";
const big = "font-display text-lg leading-tight";

/** The #1 on /trips, from the stored ranking: same weights, hidden trips and fit filter (lib/trip-list.ts). */
export function useTopPick(today: string | null): RankedRecommendation | null {
  const recs = useTrip((s) => s.recs);
  const weights = useTrip((s) => s.weights);
  const fixture = useTrip((s) => s.modes.recs === "fixture");
  const stored = useTrip((s) => s.profile);
  const lang = useLang();
  const log = useSwipe((s) => s.log);
  return useMemo(() => {
    if (!today || !recs.length) return null;
    return topTrip(rankedView(recs, weights, { fixture, profile: stored ?? DEMO_PROFILE, lang }), hiddenIds(log), today);
  }, [recs, weights, fixture, stored, lang, log, today]);
}

/**
 * The returning user's home (T16): their #1 trip and the next time off, from what is already on the device.
 * No fetch here: the ranking, the dates and the long-weekend radar were stored by /trips and /windows.
 */
export function HomeToday() {
  const hydrated = useHydrated();
  const today = useClientToday();
  const top = useTopPick(today);
  const ranges = useDates((s) => s.ranges);
  const longWeekends = useTrip((s) => s.longWeekends);
  const free = useMemo(() => (today ? nextFreeWindow(ranges, longWeekends, today) : null), [ranges, longWeekends, today]);
  // client-only: today's date and localStorage differ from the prerendered HTML
  if (!hydrated || !today) return null;
  return <TodaySummary top={top} free={free} />;
}

export function TodaySummary({ top, free }: { top: RankedRecommendation | null; free: NextWindow | null }) {
  const { t, fmt } = useT();
  const th = t.home.today;
  if (!top && !free) return null;
  return (
    <section aria-label={th.label} className="mt-6 space-y-2">
      {top && (
        <Link
          href={`/trips/${top.id}`}
          data-testid="home-top-pick"
          className={cn(card, "p-2.5 pr-3 focus-visible:outline-2 focus-visible:outline-pine")}
        >
          <CityPhoto rec={top} thumb className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className={small}>
              {th.top} · {fmt.range(top.window)}
            </p>
            <p className={cn(big, "truncate text-ink")}>{top.city}</p>
          </div>
          {/* the card's own price component: an estimate stays "~1 718 zł · szacunek", muted and italic */}
          <PriceInline
            rec={top}
            className={cn(big, "max-w-[45%] shrink-0 text-right", moneyOf(top).status !== "estimate" && "text-ink")}
          />
          <ChevronRight className="size-5 shrink-0 text-pine transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}

      {free && <FreeWindowCard w={free} />}
    </section>
  );
}

/** "11–15 lis" + "Weź 2 dni urlopu → 5 dni"; picked dates: "14–19 sty" + "Twoje terminy · 6 dni". */
function FreeWindowCard({ w }: { w: NextWindow }) {
  const { t } = useT();
  const tc = t.calendar;
  const th = t.home.today;
  const dates = formatDates(w, tc.locale);
  const holiday = w.holiday ? ("key" in w.holiday ? tc.holidays[w.holiday.key] : w.holiday.name) : null;
  const line = w.kind === "picked" ? `${th.yourDates} · ${tc.dayCount(w.total)}` : tc.suggestionLine(w.leave, w.total);
  return (
    <Link
      href="/windows"
      data-testid="home-free"
      // the holiday's name is read out and shown on hover, not another line on the card
      aria-label={[dates, holiday, line].filter(Boolean).join(", ")}
      title={holiday ?? undefined}
      className={cn(card, "px-3.5 py-3")}
    >
      <CalendarHeart className="size-5 shrink-0 text-clay" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn(big, "text-ink")}>{dates}</p>
        <p className={small}>{line}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-pine transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** Header icon for the returning view: "Moje podróże" with the number of planned trips (only when there are some). */
export function MyTripsLink() {
  const { t } = useT();
  const watched = useTrip((s) => s.approved.length);
  if (!watched) return null;
  return (
    <Link
      href="/my-trips"
      aria-label={`${t.home.today.myTrips}: ${watched}`}
      className="relative grid size-8 place-items-center rounded-full text-ink-soft hover:bg-paper-deep"
    >
      <Luggage className="size-[18px]" aria-hidden />
      <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-pine px-1 text-[10px] leading-none font-semibold text-paper tabular">
        {watched > 9 ? "9+" : watched}
      </span>
    </Link>
  );
}
