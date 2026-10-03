"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CalendarHeart, Check, Plus, Shuffle, X, Zap } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  anyDaysNextMonth,
  type DateRange,
  holidaysBetween,
  localBridges,
  mergeSuggestions,
  monthEnd,
  monthKey,
  monthsAhead,
  nextSuggestion,
  overlaps,
  rangeDays,
  thisWeekend,
  weekendIsNext,
  toFreeWindows,
} from "@/lib/date-range";
import { useTrip } from "@/lib/store";
import { cn } from "@/lib/utils";
import { FLEX_OPTIONS, todayISO, useDates, useUsableRanges } from "@/lib/windows-store";
import { useWindows } from "@/lib/windows";
import { InfoTip } from "@/components/declutter";
import { CalendarLegend, DateRangeCalendar, formatDates } from "./date-range-calendar";
import { useT } from "@/lib/i18n";
import type { DatePickerStrings } from "./strings";

/** True once the dates store has rehydrated from localStorage (avoids SSR mismatches). */
export function useDatesHydrated() {
  return useSyncExternalStore(
    (cb) => useDates.persist.onFinishHydration(cb),
    () => useDates.persist.hasHydrated(),
    () => false,
  );
}

/**
 * Today's date on the client only. /windows and /trips are prerendered at build time, so a date computed
 * during render would differ from the server HTML from the day after a deploy (React #418).
 */
const noSubscribe = () => () => {};
export function useClientToday(): string | null {
  return useSyncExternalStore(noSubscribe, todayISO, () => null);
}

/** The calendar's copy in the app-wide language (lib/i18n, namespace "calendar"). */
export function useDatePickerStrings(): DatePickerStrings {
  return useT().t.calendar;
}

function Chip({
  onClick,
  icon,
  children,
  done,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  done?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={done}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        done ? "border-pine bg-pine-soft text-pine-deep" : "border-line bg-card text-ink hover:border-pine/40",
      )}
    >
      {done ? <Check className="size-4 text-pine" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** "This weekend · Next long weekend · Any 5 days in May": one tap adds a range. */
function QuickChips({ today, onPick, className }: { today: string; onPick: (r: DateRange) => void; className?: string }) {
  const t = useDatePickerStrings();
  const ranges = useUsableRanges();
  const { longWeekends } = useWindows();
  const horizonEnd = monthEnd(monthsAhead(today, 12)[11]);
  const suggestions = useMemo(
    () => mergeSuggestions(longWeekends, localBridges(today, horizonEnd)).filter((s) => s.end >= today),
    [longWeekends, today, horizonEnd],
  );
  const has = (r: Pick<DateRange, "start" | "end">) => ranges.some((x) => x.start <= r.start && x.end >= r.end);
  const weekend = thisWeekend(today);
  const nextLong = nextSuggestion(suggestions, today);
  const anyDays = anyDaysNextMonth(today, 5);
  return (
    <div role="group" aria-label={t.quickTitle} className={cn("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1", className)}>
      <Chip onClick={() => onPick(weekend)} icon={<Zap className="size-4 text-sun" aria-hidden />} done={has(weekend)}>
        {weekendIsNext(today) ? t.chipNextWeekend : t.chipThisWeekend}
      </Chip>
      {nextLong && (
        <Chip
          onClick={() => onPick({ start: nextLong.start, end: nextLong.end })}
          icon={<Plus className="size-4 text-clay" aria-hidden />}
          done={has(nextLong)}
        >
          {t.chipNextLongWeekend} · {formatDates(nextLong, t.locale)}
        </Chip>
      )}
      <Chip
        onClick={() => onPick(anyDays)}
        icon={<Shuffle className="size-4 text-sky" aria-hidden />}
        done={ranges.some((r) => r.anyDays && r.start === anyDays.start)}
      >
        {t.chipAnyDays(anyDays.anyDays ?? 5, Number(anyDays.start.slice(5, 7)) - 1)}
      </Chip>
    </div>
  );
}

/**
 * Quick date chips + the picked ranges, for onboarding's first step ("dates and party before any
 * price question", docs/USER_TESTING.md). The full calendar stays on /windows.
 */
export function QuickDates() {
  const today = useClientToday();
  const hydrated = useDatesHydrated();
  const { add, remove } = useDates();
  const ranges = useUsableRanges();
  const t = useDatePickerStrings();
  if (!today || !hydrated) return <div aria-hidden className="h-11" />;
  return (
    <div>
      <QuickChips today={today} onPick={add} />
      {ranges.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {ranges.map((r) => (
            <li key={r.start + r.end} className="flex items-center gap-0.5 rounded-full bg-pine py-0.5 pr-0.5 pl-3 text-sm text-paper">
              {formatDates(r, t.locale)}
              <button
                type="button"
                onClick={() => remove(r)}
                aria-label={t.remove(formatDates(r, t.locale))}
                className="grid size-8 place-items-center rounded-full hover:bg-black/10"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Free time date picker: quick chips, the calendar, flexibility, suggestions and the picked list. */
export function FreeDatesPlanner() {
  const today = useClientToday();
  const hydrated = useDatesHydrated();
  // Everything below depends on today's date and the stored picks: render it on the client only.
  if (!today || !hydrated)
    return <div aria-hidden className="h-[38rem] animate-pulse rounded-3xl border border-line bg-card motion-reduce:animate-none" />;
  return <Planner today={today} />;
}

function Planner({ today }: { today: string }) {
  const t = useDatePickerStrings();
  const reduce = useReducedMotion();
  const months = useMemo(() => monthsAhead(today, 12), [today]);
  const [month, setMonth] = useState(months[0]);

  const { add, remove, clear, flexDays, setFlex } = useDates();
  const ranges = useUsableRanges();
  const { longWeekends } = useWindows();

  const horizonEnd = monthEnd(months[months.length - 1]);
  const holidays = useMemo(() => holidaysBetween(today, horizonEnd), [today, horizonEnd]);
  const suggestions = useMemo(
    () => mergeSuggestions(longWeekends, localBridges(today, horizonEnd)).filter((s) => s.end >= today),
    [longWeekends, today, horizonEnd],
  );
  const monthSuggestions = suggestions.filter((s) => monthKey(s.start) === month || monthKey(s.end) === month);

  const has = (r: Pick<DateRange, "start" | "end">) => ranges.some((x) => x.start <= r.start && x.end >= r.end);
  const [announce, setAnnounce] = useState("");

  const pick = (r: DateRange) => {
    add(r);
    setAnnounce(t.announceAdded(formatDates(r, t.locale)));
    setMonth(monthKey(r.start));
  };

  return (
    <section id="pick" data-tour="calendar" aria-labelledby="pick-title" className="scroll-mt-16 rounded-3xl border border-line bg-card p-4 shadow-soft">
      <h2 id="pick-title" className="flex items-center gap-2 font-display text-xl text-ink">
        <CalendarHeart className="size-5 text-clay" aria-hidden /> {t.sectionTitle}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t.sectionHint}</p>

      <QuickChips today={today} onPick={pick} className="mt-3" />

      <div className="mt-3">
        <DateRangeCalendar
          months={months}
          month={month}
          onMonthChange={setMonth}
          ranges={ranges}
          onAdd={add}
          holidays={holidays}
          suggestions={suggestions}
          today={today}
          t={t}
        />
      </div>

      {/* long weekends in the visible month: tap to add */}
      {monthSuggestions.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t.suggestionsTitle}</h3>
          <ul className="mt-2 space-y-2">
            {monthSuggestions.map((s) => {
              const done = has(s);
              return (
                <li key={s.start + s.end}>
                  <button
                    type="button"
                    onClick={() => !done && pick({ start: s.start, end: s.end })}
                    aria-disabled={done}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-dashed px-3.5 py-2 text-left transition-colors",
                      done ? "border-pine/40 bg-pine-soft/60" : "border-sun bg-sun-soft/70 hover:bg-sun-soft",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{t.suggestionLine(s.leave.length, rangeDays(s))}</span>
                      <span className="block truncate text-xs text-ink-soft">
                        {formatDates(s, t.locale)}
                        {s.names?.length ? ` · ${s.names.join(", ")}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                        done ? "text-pine" : "bg-ink text-paper",
                      )}
                    >
                      {done ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
                      {done ? t.added : t.add}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* div, not p: the legend inside the tip is a block */}
      <div className="mt-2 text-xs text-muted-foreground">
        {t.legendTitle}{" "}
        <InfoTip label={t.legendTitle}>
          <CalendarLegend t={t} />
        </InfoTip>
      </div>

      {/* flexibility */}
      <div className="mt-4 rounded-2xl bg-paper-deep/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <span>
            <span id="flex-label" className="block text-sm font-semibold text-ink">
              {t.flexLabel}
            </span>
            <span className="block text-xs text-ink-soft">{flexDays > 0 ? t.flexHint(flexDays) : t.flexOff}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={flexDays > 0}
            aria-labelledby="flex-label"
            onClick={() => setFlex(flexDays > 0 ? 0 : 2)}
            className="grid h-11 w-14 shrink-0 place-items-center"
          >
            <span className={cn("relative h-7 w-12 rounded-full transition-colors", flexDays > 0 ? "bg-pine" : "bg-ink/20")}>
              <motion.span
                layout={!reduce}
                className={cn("absolute top-1 size-5 rounded-full bg-paper shadow-soft", flexDays > 0 ? "right-1" : "left-1")}
              />
            </span>
          </button>
        </div>
        {flexDays > 0 && (
          <div role="radiogroup" aria-labelledby="flex-label" className="mt-2 flex gap-2">
            {FLEX_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={flexDays === n}
                onClick={() => setFlex(n)}
                className={cn(
                  "h-11 flex-1 rounded-xl text-sm font-semibold tabular-nums transition-colors",
                  flexDays === n ? "bg-ink text-paper" : "bg-card text-ink-soft hover:text-ink",
                )}
              >
                {t.flexDays(n)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* picked list */}
      <div className={cn("mt-4", ranges.length === 0 && "hidden")}>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">{t.listTitle}</h3>
          {ranges.length > 1 && (
            <button type="button" onClick={clear} className="h-11 px-1 text-xs font-medium text-muted-foreground hover:text-ink">
              {t.clearAll}
            </button>
          )}
        </div>
        {ranges.length > 0 && (
          <>
            <ul className="mt-2 flex flex-wrap gap-2">
              <AnimatePresence initial={false}>
                {ranges.map((r) => (
                  <motion.li
                    key={r.start + r.end}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.9 }}
                    className={cn(
                      "flex items-center gap-1 rounded-full py-0.5 pr-0.5 pl-3.5 text-sm",
                      r.anyDays ? "bg-sky-soft text-ink" : "bg-pine text-paper",
                    )}
                  >
                    <button type="button" onClick={() => setMonth(monthKey(r.start))} className="min-h-10 text-left">
                      <b className="font-semibold">{formatDates(r, t.locale)}</b>{" "}
                      <span className="opacity-75">· {r.anyDays ? t.anyDays(r.anyDays) : t.dayCount(rangeDays(r))}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        remove(r);
                        setAnnounce(t.announceRemoved(formatDates(r, t.locale)));
                      }}
                      aria-label={t.remove(formatDates(r, t.locale))}
                      className="grid size-11 place-items-center rounded-full hover:bg-black/10"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{t.priorityNote}</p>
            <Link
              href="/trips"
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-pine text-base font-medium text-primary-foreground"
            >
              {t.showTrips} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </>
        )}
      </div>

      <p className="sr-only" role="status">
        {announce}
      </p>
    </section>
  );
}

/** Trips page header: "For your dates: 12–20 Feb · Edit". Renders nothing when no dates are picked. */
export function PickedDatesHeader() {
  const t = useDatePickerStrings();
  const hydrated = useDatesHydrated();
  const today = useClientToday();
  const active = useUsableRanges();
  const flexDays = useDates((s) => s.flexDays);
  const recs = useTrip((s) => s.recs);
  const fixture = useTrip((s) => s.modes.recs) === "fixture";
  if (!hydrated || !today || !active.length) return null;
  const windows = toFreeWindows(active, flexDays, today);
  // Sample data can't price arbitrary dates (lib/mock/api.ts): say so instead of implying a match.
  const offDates = fixture && recs.length > 0 && !recs.some((r) => windows.some((w) => overlaps(r.window, w)));
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 rounded-2xl bg-ink px-3.5 py-1.5 text-sm text-paper">
        <CalendarHeart className="size-4 shrink-0 text-sun" aria-hidden />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="text-paper/70">{t.forYourDates}</span>{" "}
          <b className="font-semibold">
            {active.map((r) => (r.anyDays ? `${formatDates(r, t.locale)} (${t.anyDays(r.anyDays)})` : formatDates(r, t.locale))).join(", ")}
          </b>
          {flexDays > 0 && <span className="text-paper/70"> · {t.flexSuffix(flexDays)}</span>}
        </p>
        <Link
          href="/windows#pick"
          className="-mr-1.5 flex h-11 shrink-0 items-center rounded-full px-3 font-medium text-sun hover:bg-paper/10"
        >
          {t.edit}
        </Link>
      </div>
      {offDates && <p className="mt-1.5 px-1 text-xs leading-snug text-muted-foreground">{t.sampleOnly}</p>}
    </div>
  );
}

/**
 * Trips page, nothing came back: for picked dates explain why and offer a way out (flexibility, the next
 * long weekend, edit). Without picked dates it renders `children` (the page's generic empty state).
 */
export function PickedDatesEmpty({ children }: { children: React.ReactNode }) {
  const t = useDatePickerStrings();
  const hydrated = useDatesHydrated();
  const today = useClientToday();
  const active = useUsableRanges();
  const { flexDays, setFlex, add } = useDates();
  const { longWeekends } = useWindows();
  if (!hydrated || !today || !active.length) return <>{children}</>;
  const horizonEnd = monthEnd(monthsAhead(today, 12)[11]);
  const next = nextSuggestion(mergeSuggestions(longWeekends, localBridges(today, horizonEnd)), today);
  const nextNew = next && !active.some((r) => overlaps(r, next)) ? next : undefined;
  const dates = active.map((r) => formatDates(r, t.locale)).join(", ");
  return (
    <div role="status" className="mt-6 rounded-3xl border border-line bg-card p-5 text-center shadow-soft">
      <CalendarHeart className="mx-auto size-7 text-clay" aria-hidden />
      <p className="mt-2 font-display text-xl text-ink">{t.emptyTitle(dates)}</p>
      <p className="mt-1 text-sm leading-snug text-ink-soft">{t.emptyBody}</p>
      <div className="mt-4 flex flex-col gap-2">
        {flexDays < 3 && (
          <button
            type="button"
            onClick={() => setFlex(flexDays + 2 > 3 ? 3 : flexDays + 2)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-pine px-4 text-sm font-medium text-primary-foreground"
          >
            <Shuffle className="size-4" aria-hidden /> {t.emptyFlex(flexDays + 2 > 3 ? 3 : flexDays + 2)}
          </button>
        )}
        {nextNew && (
          <button
            type="button"
            onClick={() => add({ start: nextNew.start, end: nextNew.end })}
            className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-dashed border-sun bg-sun-soft px-4 text-sm font-medium text-ink"
          >
            <Plus className="size-4 text-clay" aria-hidden /> {t.emptyAddSuggestion(formatDates(nextNew, t.locale))}
          </button>
        )}
        <Link
          href="/windows#pick"
          className="flex min-h-11 items-center justify-center rounded-2xl px-4 text-sm font-medium text-pine hover:underline"
        >
          {t.emptyEdit}
        </Link>
      </div>
    </div>
  );
}
