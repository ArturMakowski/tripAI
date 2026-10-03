"use client";

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  addDays,
  dowMon,
  inRange,
  type DateRange,
  type ISODate,
  isWeekend,
  monthGrid,
  monthEnd,
  monthKey,
  moveFocus,
  type PlHoliday,
  previewRange,
  rangeDays,
  type Suggestion,
  tapDay,
} from "@/lib/date-range";
import { cn } from "@/lib/utils";
import type { DatePickerStrings } from "./strings";

const noon = (iso: ISODate) => new Date(`${iso}T12:00:00Z`);

/** "12–20 lut" / "28 Feb – 3 Mar" in the picker's locale. */
export function formatDates(r: Pick<DateRange, "start" | "end">, locale: string): string {
  const day = (iso: ISODate) => noon(iso).getUTCDate();
  const mon = (iso: ISODate) => noon(iso).toLocaleString(locale, { month: "short", timeZone: "UTC" }).replace(".", "");
  if (r.start === r.end) return `${day(r.start)} ${mon(r.start)}`;
  if (monthKey(r.start) === monthKey(r.end)) return `${day(r.start)}–${day(r.end)} ${mon(r.end)}`;
  return `${day(r.start)} ${mon(r.start)} – ${day(r.end)} ${mon(r.end)}`;
}

export function monthTitle(key: string, locale: string, form: "long" | "short" = "long"): string {
  const s = noon(`${key}-01`).toLocaleString(locale, { month: form, year: form === "long" ? "numeric" : undefined, timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1).replace(".", "");
}

const fullDay = (iso: ISODate, locale: string) =>
  noon(iso).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export interface DateRangeCalendarProps {
  months: string[]; // "2026-10", … (swipeable)
  month: string;
  onMonthChange: (m: string) => void;
  ranges: DateRange[];
  onAdd: (r: DateRange) => void;
  holidays: PlHoliday[];
  suggestions: Suggestion[];
  today: ISODate;
  t: DatePickerStrings;
}

/**
 * Month calendar with tap-tap range selection. One month at a time: swipe, use the arrows or the month
 * strip, or move with the keyboard (arrows, Home/End, PageUp/PageDown, Enter/Space, Esc).
 */
export function DateRangeCalendar({
  months,
  month,
  onMonthChange,
  ranges,
  onAdd,
  holidays,
  suggestions,
  today,
  t,
}: DateRangeCalendarProps) {
  const reduce = useReducedMotion();
  const [anchor, setAnchor] = useState<ISODate | null>(null);
  const [hover, setHover] = useState<ISODate | null>(null);
  const [focused, setFocused] = useState<ISODate>(() => (monthKey(today) === month ? today : `${month}-01`));
  const [dir, setDir] = useState(0);
  const [announce, setAnnounce] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);

  const idx = months.indexOf(month);
  const first = `${months[0]}-01`;
  const lastDay = monthEnd(months[months.length - 1]);
  const holidayAt = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);
  const preview = previewRange(anchor, hover);
  const anchorSuggestion = anchor ? suggestions.find((s) => inRange(anchor, s)) : undefined;

  const go = (m: string, opts?: { focusDay?: ISODate }) => {
    if (!months.includes(m) || m === month) return;
    setDir(m > month ? 1 : -1);
    onMonthChange(m);
    const day = opts?.focusDay ?? (monthKey(today) === m ? today : `${m}-01`);
    setFocused(day);
  };

  // Keyboard focus follows `focused` after a key press (and after the month animates in).
  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focused}"]`)?.focus();
  }, [focused, month]);

  const tap = (day: ISODate) => {
    const res = tapDay({ ranges, anchor }, day, today);
    if (res.added) {
      onAdd(res.added);
      setAnnounce(t.announceAdded(formatDates(res.added, t.locale)));
      setHover(null);
    } else if (res.anchor) {
      setAnnounce(t.announceAnchor(fullDay(res.anchor, t.locale)));
    }
    setAnchor(res.anchor);
    setFocused(day);
  };

  const cancel = () => {
    setAnchor(null);
    setHover(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, iso: ISODate) => {
    if (e.key === "Escape" && anchor) {
      e.preventDefault();
      cancel();
      return;
    }
    const next = moveFocus(iso, e.key);
    if (!next) return;
    e.preventDefault();
    // past days are disabled (can't take focus), so arrows stop at today
    if (next < first || next < today || next > lastDay) return;
    wantFocus.current = true;
    if (anchor) setHover(next);
    if (monthKey(next) !== month) go(monthKey(next), { focusDay: next });
    else setFocused(next);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe < -70 && idx < months.length - 1) go(months[idx + 1]);
    else if (swipe > 70 && idx > 0) go(months[idx - 1]);
  };

  const grid = monthGrid(month);
  const visibleHolidays = holidays.filter((h) => monthKey(h.date) === month);

  return (
    <div>
      {/* month header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(months[idx - 1])}
          disabled={idx <= 0}
          aria-label={t.prevMonth}
          className="grid size-11 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-30"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <h3 id={`cal-${month}`} className="font-display text-xl text-ink">
          {monthTitle(month, t.locale)}
        </h3>
        <button
          type="button"
          onClick={() => go(months[idx + 1])}
          disabled={idx >= months.length - 1}
          aria-label={t.nextMonth}
          className="grid size-11 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-30"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      {/* month strip: jump anywhere in the next 12 months; a dot marks months with picked dates */}
      <div className="no-scrollbar -mx-1 mt-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {months.map((m) => {
          const has = ranges.some((r) => r.start <= `${m}-31` && r.end >= `${m}-01`);
          const active = m === month;
          return (
            <button
              key={m}
              type="button"
              onClick={() => go(m)}
              aria-label={t.jumpToMonth(monthTitle(m, t.locale))}
              aria-current={active ? "date" : undefined}
              className={cn(
                "relative flex h-11 min-w-12 shrink-0 flex-col items-center justify-center rounded-xl px-2 text-xs font-medium transition-colors",
                active ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep",
              )}
            >
              {monthTitle(m, t.locale, "short")}
              <span className={cn("mt-0.5 size-1 rounded-full", has ? (active ? "bg-sun" : "bg-pine") : "bg-transparent")} aria-hidden />
            </button>
          );
        })}
      </div>

      {/* weekday header */}
      <div
        className="mt-2 grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        aria-hidden
      >
        {t.weekdays.map((w, i) => (
          <span key={w} className={cn("py-1", i >= 5 && "text-clay/80")}>
            {w}
          </span>
        ))}
      </div>

      <div className="relative overflow-hidden" ref={gridRef}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={month}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: reduce ? 0 : d * 56, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: reduce ? 0 : d * -56, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 36 }}
            drag={reduce ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            dragDirectionLock
            onDragEnd={onDragEnd}
            role="grid"
            aria-labelledby={`cal-${month}`}
            aria-multiselectable="true"
            className="touch-pan-y select-none"
            onPointerLeave={() => setHover(null)}
          >
            {grid.map((week, wi) => (
              <div role="row" key={wi} className="grid grid-cols-7">
                {week.map((iso, di) => {
                  if (!iso) return <div role="gridcell" key={di} className="h-12" />;
                  const range = ranges.find((r) => inRange(iso, r));
                  const sel = !!range;
                  const isStart = !!range && (iso === range.start || dowMon(iso) === 0 || iso.endsWith("-01"));
                  const isEnd = !!range && (iso === range.end || dowMon(iso) === 6 || addDays(iso, 1).endsWith("-01"));
                  const edge = !!range && !range.anyDays && (iso === range.start || iso === range.end);
                  const inPrev = !!preview && inRange(iso, preview);
                  const prevStart = inPrev && (iso === preview!.start || dowMon(iso) === 0);
                  const prevEnd = inPrev && (iso === preview!.end || dowMon(iso) === 6);
                  const sug = suggestions.find((s) => inRange(iso, s));
                  const sugStart = !!sug && (iso === sug.start || dowMon(iso) === 0);
                  const sugEnd = !!sug && (iso === sug.end || dowMon(iso) === 6);
                  const hol = holidayAt.get(iso);
                  const leave = !!sug?.leave.includes(iso);
                  const past = iso < today;
                  const isToday = iso === today;
                  const isAnchor = iso === anchor;
                  const label = [
                    fullDay(iso, t.locale),
                    isToday && t.today,
                    hol && `${t.holiday}: ${t.holidays[hol.key]}`,
                    sug && t.suggestion,
                    leave && t.takeOff,
                    past && t.past,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <div role="gridcell" key={iso} aria-selected={sel || isAnchor} className="relative h-12">
                      {/* long-weekend suggestion: a soft dashed band */}
                      {sug && !sel && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inset-y-1 right-0 left-0 border-y border-dashed border-sun/70 bg-sun-soft/80",
                            sugStart && "left-0.5 rounded-l-full border-l",
                            sugEnd && "right-0.5 rounded-r-full border-r",
                          )}
                        />
                      )}
                      {/* picked range band */}
                      {sel && (
                        <motion.span
                          aria-hidden
                          initial={reduce ? false : { opacity: 0, scaleX: 0.6 }}
                          animate={{ opacity: 1, scaleX: 1 }}
                          className={cn(
                            "absolute inset-y-1 right-0 left-0",
                            range?.anyDays ? "bg-sky-soft" : "bg-pine-soft",
                            isStart && "left-0.5 rounded-l-full",
                            isEnd && "right-0.5 rounded-r-full",
                          )}
                        />
                      )}
                      {/* hover/focus preview while choosing the end */}
                      {inPrev && !sel && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inset-y-1 right-0 left-0 border-y-2 border-dashed border-pine/45 bg-pine-soft/40",
                            prevStart && "left-0.5 rounded-l-full border-l-2",
                            prevEnd && "right-0.5 rounded-r-full border-r-2",
                          )}
                        />
                      )}
                      <button
                        type="button"
                        data-iso={iso}
                        tabIndex={iso === focused ? 0 : -1}
                        disabled={past}
                        aria-label={label}
                        onClick={() => tap(iso)}
                        onKeyDown={(e) => onKeyDown(e, iso)}
                        onPointerEnter={() => anchor && setHover(iso)}
                        onFocus={() => {
                          setFocused(iso);
                          if (anchor) setHover(iso);
                        }}
                        className={cn(
                          "relative z-10 mx-auto grid size-11 place-items-center rounded-full text-[15px] font-medium tabular-nums transition-[background-color,color,transform] duration-150",
                          "focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-2 focus-visible:ring-offset-paper focus-visible:outline-none",
                          "motion-safe:active:scale-90",
                          past ? "cursor-default text-ink/25" : "text-ink hover:bg-ink/5",
                          !past && isWeekend(iso) && !sel && "text-clay",
                          hol && !past && "font-semibold text-clay",
                          sel && !edge && (range?.anyDays ? "text-sky" : "text-pine-deep"),
                          edge && "bg-pine text-paper shadow-soft hover:bg-pine-deep",
                          isAnchor && "bg-pine text-paper",
                          isToday && !edge && !isAnchor && "ring-1 ring-ink/40",
                        )}
                      >
                        {Number(iso.slice(8))}
                        {/* markers: holiday (clay dot), day off to take (hollow sun ring) */}
                        {(hol || leave) && (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full",
                              hol ? (edge || isAnchor ? "bg-paper" : "bg-clay") : "border border-sun bg-transparent",
                            )}
                          />
                        )}
                        {isAnchor && !reduce && (
                          <span
                            aria-hidden
                            className="absolute inset-0 animate-ping rounded-full bg-pine/30 [animation-iteration-count:2]"
                          />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* status bar: what the next tap does */}
      <div className="min-h-11">
        <AnimatePresence initial={false}>
          {anchor && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4 }}
              className="mt-2 space-y-2"
            >
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-ink px-4 py-1.5 text-sm text-paper">
                <span>
                  <b className="font-semibold">{t.pickEnd}</b> <span className="text-paper/60">· {t.pickEndHint}</span>
                </span>
                <button type="button" onClick={cancel} className="-mr-2 h-11 rounded-full px-3 font-medium text-sun hover:bg-paper/10">
                  {t.cancel}
                </button>
              </div>
              {anchorSuggestion && (
                <button
                  type="button"
                  onClick={() => {
                    onAdd({ start: anchorSuggestion.start, end: anchorSuggestion.end });
                    setAnnounce(t.announceAdded(formatDates(anchorSuggestion, t.locale)));
                    cancel();
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-dashed border-sun bg-sun-soft px-4 py-2 text-left text-sm font-medium text-ink hover:bg-sun-soft/70"
                >
                  <Plus className="size-4 shrink-0 text-clay" aria-hidden />
                  {t.addWholeSuggestion(formatDates(anchorSuggestion, t.locale), rangeDays(anchorSuggestion))}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {visibleHolidays.length > 0 && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {visibleHolidays.map((h, i) => (
            <span key={h.date}>
              {i > 0 && " · "}
              <span className="font-semibold text-clay">{Number(h.date.slice(8))}</span> {t.holidays[h.key]}
            </span>
          ))}
        </p>
      )}

      <p className="sr-only" role="status">
        {announce}
      </p>
    </div>
  );
}

export function CalendarLegend({ t }: { t: DatePickerStrings }) {
  const items = [
    [t.legendSelected, "size-3 rounded-full bg-pine"],
    [t.legendHoliday, "size-1.5 rounded-full bg-clay"],
    [t.legendSuggestion, "h-3 w-5 rounded-full border border-dashed border-sun bg-sun-soft"],
    [t.legendToday, "size-3 rounded-full ring-1 ring-ink/40"],
  ] as const;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {items.map(([label, cls]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={cls} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}
