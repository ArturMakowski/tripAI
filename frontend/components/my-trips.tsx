"use client";

/**
 * T24 "manage my trips" (docs/USER_TESTING.md round 4): the per-trip actions on /my-trips.
 *  - SwipeDelete: drag a row left to delete it, like the swipeable rows on /trips (touch-action: pan-y +
 *    direction lock, so vertical drags stay a page scroll; a red reveal shows what will happen).
 *  - RowMenu: "⋯" with the same actions as buttons (keyboard and screen readers): edit, book, delete.
 *  - UndoToast: "Usunięto: Neapol · Cofnij" (the delete is soft on the server, so undo really restores it).
 *  - EditSheet: new dates (the calendar + quick chips) and/or party size, then a re-price.
 */
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "motion/react";
import { CalendarClock, CircleCheck, MoreHorizontal, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DateRangeCalendar, formatDates } from "@/components/date-picker/date-range-calendar";
import { useClientToday, useDatePickerStrings } from "@/components/date-picker/free-dates-planner";
import { PartyPicker } from "@/components/money";
import { Button } from "@/components/ui/button";
import { holidaysBetween, localBridges, monthEnd, monthKey, monthStart, monthsAhead, weekendIsNext, type DateRange } from "@/lib/date-range";
import { useT } from "@/lib/i18n";
import { editChips, editError, type EditDraft, type EditError, type TripAction } from "@/lib/trips";
import type { TripItem } from "@/lib/types";
import { lockedSwipeIntent } from "@/lib/swipe-session";
import { cn } from "@/lib/utils";

/**
 * Swipe left to delete, with the same feel as the /trips rows (T23): the shared commit thresholds
 * (lockedSwipeIntent: distance or speed, and only for a drag motion locked to the x axis, so a drag
 * that starts vertical never deletes), a red reveal, a slide-out, and the click after a drag swallowed.
 */
export function SwipeDelete({ onDelete, children, label, disabled }: { onDelete: () => void; children: ReactNode; label: string; disabled?: boolean }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const reveal = useTransform(x, [-96, -12], [1, 0]);
  const axis = useRef<"x" | "y" | null>(null);
  const dragged = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const end = (_: unknown, info: PanInfo) => {
    const intent = lockedSwipeIntent(axis.current, info.offset.x, info.velocity.x);
    axis.current = null;
    if (intent === "dislike") {
      setLeaving(true);
      onDelete();
    }
    setTimeout(() => (dragged.current = false), 0);
  };
  return (
    <div className="relative overflow-x-clip rounded-2xl" onDragStartCapture={(e) => e.preventDefault()}>
      <motion.div
        aria-hidden
        style={{ opacity: reveal }}
        className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-2xl bg-clay pr-5 text-sm font-semibold text-paper"
      >
        <Trash2 className="size-4" /> {label}
      </motion.div>
      <motion.div
        drag={reduce || disabled ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.6, right: 0 }}
        dragSnapToOrigin={!leaving}
        animate={leaving ? { x: -480, opacity: 0 } : undefined}
        transition={leaving ? { duration: 0.22, ease: "easeIn" } : undefined}
        onDragStart={() => (dragged.current = true)}
        onDirectionLock={(a) => (axis.current = a)}
        onDragEnd={end}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={{ x, touchAction: "pan-y" }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}

/** "⋯" → a small menu of buttons. Esc or a tap outside closes it; focus goes to the first action. */
export function RowMenu({ city, actions, onAction }: { city: string; actions: TripAction[]; onAction: (a: TripAction) => void }) {
  const { t } = useT();
  const m = t.myTrips;
  const label = m.more(city);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-paper-deep hover:text-ink"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute top-10 right-0 z-20 min-w-56 rounded-2xl border border-line bg-card p-1.5 shadow-lift">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAction(a);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-paper-deep",
                a === "remove" ? "text-clay" : "text-ink",
              )}
            >
              {MENU_ICONS[a]}
              {m[a]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MENU_ICONS: Record<TripAction, ReactNode> = {
  edit: <CalendarClock className="size-4" aria-hidden />,
  book: <CircleCheck className="size-4" aria-hidden />,
  unbook: <Undo2 className="size-4" aria-hidden />,
  remove: <Trash2 className="size-4" aria-hidden />,
};

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

/** Floats above the bottom nav; never covers the page title. Leaves on its own after `ms`. */
export function UndoToast({ toast, onClose, ms }: { toast: Toast | null; onClose: () => void; ms: number }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [toast, ms, onClose]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            role="status"
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-paper shadow-lift"
          >
            <span className="min-w-0 flex-1">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  onClose();
                }}
                className="shrink-0 font-semibold text-sun hover:underline"
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ERROR_KEY: Record<EditError, "editPast" | "editTooShort" | "editTooLong" | "editUnchanged"> = {
  past: "editPast",
  tooShort: "editTooShort",
  tooLong: "editTooLong",
  unchanged: "editUnchanged",
};

/** Bottom sheet: dates (quick chips + the calendar) and party size → "Przelicz cenę". */
export function EditSheet({
  trip,
  onSave,
  onClose,
}: {
  trip: TripItem;
  /** resolves to an error message, or null when saved */
  onSave: (draft: EditDraft) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t, fmt } = useT();
  const m = t.myTrips;
  const ds = useDatePickerStrings();
  const today = useClientToday();
  const [draft, setDraft] = useState<EditDraft>({ start: trip.start, end: trip.end, travelers: trip.travelers });
  const [month, setMonth] = useState(monthKey(trip.start));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const months = useMemo(() => (today ? monthsAhead(today, 12) : []), [today]);
  const horizonEnd = months.length ? monthEnd(months[months.length - 1]) : trip.end;
  const holidays = useMemo(() => (today ? holidaysBetween(monthStart(months[0]), horizonEnd) : []), [today, months, horizonEnd]);
  const suggestions = useMemo(() => (today ? localBridges(today, horizonEnd) : []), [today, horizonEnd]);
  const chips = today ? editChips(trip, today, suggestions) : [];
  const invalid = today ? editError(trip, draft, today) : "unchanged";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (r: Pick<DateRange, "start" | "end">) => {
    setDraft((d) => ({ ...d, start: r.start, end: r.end }));
    setMonth(monthKey(r.start));
    setError(null);
  };

  async function save() {
    if (invalid) return;
    setBusy(true);
    const err = await onSave(draft);
    setBusy(false);
    if (err) setError(err);
  }

  const chipLabel = (k: (typeof chips)[number]) =>
    k.key === "earlier"
      ? m.chipEarlier
      : k.key === "later"
        ? m.chipLater
        : k.key === "weekend"
          ? today && weekendIsNext(today)
            ? ds.chipNextWeekend
            : ds.chipThisWeekend
          : m.chipLongWeekend(formatDates(k.range, ds.locale));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-trip-h"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lift"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="edit-trip-h" className="font-display text-xl text-ink">
              {m.editTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {trip.city} · {fmt.range(draft)} · {m.party(draft.travelers)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={m.editCancel} className="grid size-9 place-items-center rounded-full hover:bg-paper-deep">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {chips.length > 0 && (
          <div role="group" aria-label={ds.quickTitle} className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => pick(c.range)}
                className="shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-sm text-ink hover:border-pine/40"
              >
                {chipLabel(c)}
              </button>
            ))}
          </div>
        )}

        {today && (
          <div className="mt-3">
            <DateRangeCalendar
              months={months}
              month={months.includes(month) ? month : months[0]}
              onMonthChange={setMonth}
              ranges={[{ start: draft.start, end: draft.end }]}
              onAdd={pick}
              holidays={holidays}
              suggestions={suggestions}
              today={today}
              t={ds}
            />
          </div>
        )}

        <PartyPicker className="mt-4" value={draft.travelers} onChange={(n) => setDraft((d) => ({ ...d, travelers: n }))} />

        <p role="alert" className="mt-3 min-h-5 text-sm text-clay">
          {error ?? (invalid && invalid !== "unchanged" ? m[ERROR_KEY[invalid]] : "")}
        </p>
        <Button size="lg" className="mt-1 h-12 w-full rounded-2xl text-base" disabled={!!invalid || busy} onClick={save}>
          {m.editSave}
        </Button>
      </motion.div>
    </div>
  );
}
