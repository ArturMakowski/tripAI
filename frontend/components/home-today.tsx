"use client";

import Link from "next/link";
import { Bell, CalendarHeart, ChevronRight, Luggage } from "lucide-react";
import { useMemo, useState } from "react";
import { PriceInline } from "@/components/money";
import { CityPhoto } from "@/components/rec-card";
import { useClientToday } from "@/components/date-picker/free-dates-planner";
import { formatDates } from "@/components/date-picker/date-range-calendar";
import { dayCount } from "@/lib/format";
import { moneyOf } from "@/lib/money";
import { freeWindows, topPick, type NextWindow } from "@/lib/home-today";
import { useT } from "@/lib/i18n";
import { useInbox } from "@/lib/notify";
import { useHydrated, useTrip } from "@/lib/store";
import type { RankedRecommendation } from "@/lib/types";
import { useDates } from "@/lib/windows-store";

const card = "rounded-2xl border border-line bg-card shadow-soft transition-shadow hover:shadow-lift";

/**
 * The returning user's home (T16): their #1 trip and the next time off, from what is already on the device.
 * No fetch here: the ranking, the dates and the long-weekend radar were stored by /trips and /windows.
 */
export function HomeToday() {
  const hydrated = useHydrated();
  const today = useClientToday();
  const recs = useTrip((s) => s.recs);
  const recsAt = useTrip((s) => s.recsMeta?.at ?? null);
  const longWeekends = useTrip((s) => s.longWeekends);
  const watched = useTrip((s) => s.approved.length);
  const ranges = useDates((s) => s.ranges);
  const unread = useInbox((s) => s.unread);
  const [now] = useState(() => Date.now()); // "checked 2 h ago" is judged once per visit
  const top = useMemo(() => (today ? topPick(recs, today) : null), [recs, today]);
  const free = useMemo(() => (today ? freeWindows(ranges, longWeekends, today) : []), [ranges, longWeekends, today]);
  // client-only: today's date and localStorage differ from the prerendered HTML
  if (!hydrated || !today) return null;
  return <TodaySummary top={top} checkedAt={recsAt} free={free} watched={watched} unread={unread} now={now} />;
}

export function TodaySummary({
  top,
  checkedAt,
  free,
  watched,
  unread,
  now,
}: {
  top: RankedRecommendation | null;
  /** when the stored ranking was fetched (ms) */
  checkedAt: number | null;
  free: NextWindow[];
  watched: number;
  unread: number;
  now: number;
}) {
  const { t, fmt } = useT();
  const th = t.home.today;
  if (!top && !free.length && !watched && !unread) return null;
  return (
    <section aria-label={th.label} className="mt-5 space-y-2">
      {top && (
        <Link
          href={`/trips/${top.id}`}
          data-testid="home-top-pick"
          className={`${card} group flex items-center gap-3 p-2.5 pr-3 focus-visible:outline-2 focus-visible:outline-pine`}
        >
          <CityPhoto rec={top} thumb className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-pine">{th.top}</p>
            <p className="truncate font-display text-xl leading-tight text-ink">{top.city}</p>
            <p className="truncate text-[13px] text-ink-soft">
              {fmt.range(top.window)} · {t.trips.card.nights(dayCount(top.window) - 1)}
            </p>
            {checkedAt != null && (
              <p className="truncate text-[11px] text-muted-foreground">{th.checked(fmt.relative(new Date(checkedAt).toISOString(), now))}</p>
            )}
          </div>
          <div className="max-w-[45%] shrink-0 text-right text-sm leading-snug">
            {/* an estimate stays muted and italic, as on the card ("~1 718 zł · szacunek") */}
            <PriceInline rec={top} className={moneyOf(top).status === "estimate" ? undefined : "font-semibold text-ink"} />
          </div>
          <ChevronRight className="size-5 shrink-0 text-pine transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}

      {free.length > 0 && (
        <Link href="/windows" data-testid="home-free" className={`${card} group flex items-center gap-3 px-3.5 py-3`}>
          <CalendarHeart className="size-5 shrink-0 text-clay" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-pine">{th.free}</p>
            {free.map((w) => (
              <WindowLine key={w.kind} w={w} />
            ))}
          </div>
          <ChevronRight className="size-5 shrink-0 text-pine transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}

      {(watched > 0 || unread > 0) && (
        <p className="flex items-center justify-center gap-3 text-sm text-ink-soft">
          {watched > 0 && (
            <Link href="/my-trips" className="inline-flex min-h-10 items-center gap-1.5 hover:text-ink">
              <Luggage className="size-4 text-pine" aria-hidden /> {th.myTrips} <span className="tabular font-semibold text-ink">{watched}</span>
            </Link>
          )}
          {watched > 0 && unread > 0 && <span aria-hidden className="text-line">·</span>}
          {unread > 0 && (
            <Link href="/inbox" className="inline-flex min-h-10 items-center gap-1.5 hover:text-ink">
              <Bell className="size-4 text-clay" aria-hidden /> {th.inbox} <span className="font-semibold text-ink">{th.unread(unread)}</span>
            </Link>
          )}
        </p>
      )}
    </section>
  );
}

/** "11–15 lis · Święto Niepodległości" + "Weź 2 dni urlopu → 5 dni"; picked dates: "14–19 sty · 6 dni". */
function WindowLine({ w }: { w: NextWindow }) {
  const { t } = useT();
  const tc = t.calendar;
  const dates = formatDates(w, tc.locale);
  if (w.kind === "picked")
    return (
      <p className="truncate text-[15px] text-ink">
        <span className="text-muted-foreground">{t.home.today.yourDates}:</span> {dates} · {tc.dayCount(w.total)}
      </p>
    );
  const name = w.holiday ? ("key" in w.holiday ? tc.holidays[w.holiday.key] : w.holiday.name) : t.home.today.longWeekend;
  return (
    <div className="mt-0.5 first:mt-0">
      <p className="truncate text-[15px] text-ink">
        <span className="font-display">{dates}</span> · {name}
      </p>
      <p className="text-[13px] text-ink-soft">{tc.suggestionLine(w.leave, w.total)}</p>
    </div>
  );
}
