"use client";

/**
 * Swipeable rows on /trips (one ranked list, no separate deck), like mail-app rows:
 *  - swipe right = "Chcę tam" (like: POST /reactions, the learned toast, the price is watched),
 *  - swipe left = "Nie dla mnie" (the row collapses out; the toast offers Undo, which brings it back
 *    in place), a heart button = "Super!" (a vertical swipe would fight the page scroll),
 *  - a coloured reveal behind the card while dragging, and a distance/speed threshold before it commits,
 *  - only clearly horizontal drags count (touch-action: pan-y + direction lock); a tap opens the trip,
 *  - keyboard: "⋯" opens the same actions as buttons; on a focused row → / ← act, Backspace undoes.
 * Learning is buffered and committed once ("Show the new ranking", or leaving /trips).
 */
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { Check, ChevronDown, EyeOff, Heart, MoreHorizontal, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CityPhoto } from "@/components/rec-card";
import { PriceInline } from "@/components/money";
import { useLang, useT } from "@/lib/i18n";
import { swipeCopy, toastText } from "@/lib/reactions";
import { swipeIntent, TOAST_MS, useSwipeSession } from "@/lib/swipe-session";
import type { RankedRecommendation } from "@/lib/types";
import { commitLearning, currentBase, hiddenIds, react, unreact, useSwipe } from "@/lib/use-reactions";
import { cn } from "@/lib/utils";

export type RowReaction = "like" | "dislike" | "love";

/**
 * The row actions, in order: each reaction builds on the previous one's profile, and undo waits for
 * every pending swipe, so "last" is always the trip the user means.
 */
export function useRowSwipes() {
  const lang = useLang();
  const t = swipeCopy(lang);
  const { remember, forget, hide, unhide, showToast } = useSwipeSession();
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());
  const [saving, setSaving] = useState(0);
  const [undoing, setUndoing] = useState(false);

  const swipe = useCallback(
    (rec: RankedRecommendation, reaction: RowReaction) => {
      if (reaction === "dislike") hide(rec.id); // collapse now; the log takes over once the backend answers
      setSaving((n) => n + 1);
      inFlight.current = inFlight.current
        .then(async () => {
          const personalized = currentBase().profile.personalize !== false;
          const entry = await react(rec, reaction);
          remember(entry);
          showToast(toastText(entry.res, lang, { personalized, watch: entry.watch }), true);
        })
        .catch((err) => {
          // not saved (or unknown): never pretend it was; a swiped-away row comes back
          console.warn("[tripai] reaction not saved:", err);
          showToast(t.swipeFailed(rec.city));
        })
        .finally(() => {
          unhide(rec.id);
          setSaving((n) => n - 1);
        });
    },
    [lang, t, hide, unhide, remember, showToast],
  );

  const undo = useCallback(() => {
    const last = useSwipeSession.getState().history.at(-1);
    if (!last || saving > 0 || undoing) return;
    setUndoing(true);
    inFlight.current = inFlight.current
      .then(() => unreact(last))
      .then(() => {
        forget(last);
        showToast(t.undone(last.rec.city));
      })
      .catch((err) => {
        console.warn("[tripai] undo failed:", err);
        showToast(t.undoFailed(last.rec.city)); // the reaction still stands, and we say so
      })
      .finally(() => setUndoing(false));
  }, [saving, undoing, forget, showToast, t]);

  const history = useSwipeSession((s) => s.history);
  return { swipe, undo, canUndo: history.length > 0 && saving === 0 && !undoing };
}

/** Backspace undoes the last swipe on /trips (not while typing). */
export function useUndoShortcut(undo: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);
}

/**
 * One swipeable row. Wraps a trip card: drag it right (like) or left (not for me); a coloured layer
 * behind it shows what will happen. Vertical drags are left to the page scroll.
 */
export function SwipeRow({
  rec,
  onReact,
  children,
  tour,
}: {
  rec: RankedRecommendation;
  onReact: (rec: RankedRecommendation, r: RowReaction) => void;
  children: ReactNode;
  /** coach-mark anchor (first row only) */
  tour?: string;
}) {
  const lang = useLang();
  const t = swipeCopy(lang);
  const x = useMotionValue(0);
  const likeOpacity = useTransform(x, [12, 96], [0, 1]);
  const nopeOpacity = useTransform(x, [-96, -12], [1, 0]);
  const dragged = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const intent = swipeIntent(info.offset.x, info.velocity.x);
    if (intent === "dislike") {
      setLeaving(true); // slides out; the list then collapses the row
      onReact(rec, "dislike");
    } else if (intent === "like") onReact(rec, "like");
    // a drag is never also a tap: swallow the click that follows the release
    setTimeout(() => (dragged.current = false), 0);
  };

  return (
    <div
      className="relative select-none"
      data-tour={tour}
      // no native image/link drag: it would steal the pointer from the row swipe
      onDragStartCapture={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // on a focused row (its link or a button inside): → like, ← not for me
        if (e.altKey || e.metaKey || e.ctrlKey) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onReact(rec, "like");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setLeaving(true);
          onReact(rec, "dislike");
        }
      }}
    >
      {/* the reveal behind the card */}
      <div aria-hidden className="absolute inset-0 flex items-center justify-between overflow-hidden rounded-[1.75rem] px-6">
        <motion.span style={{ opacity: likeOpacity }} className="absolute inset-0 rounded-[1.75rem] bg-pine" />
        <motion.span style={{ opacity: nopeOpacity }} className="absolute inset-0 rounded-[1.75rem] bg-clay" />
        <motion.span style={{ opacity: likeOpacity }} className="relative flex items-center gap-2 font-semibold text-paper">
          <Check className="size-6" /> {t.like}
        </motion.span>
        <motion.span style={{ opacity: nopeOpacity }} className="relative flex items-center gap-2 font-semibold text-paper">
          {t.dislike} <X className="size-6" />
        </motion.span>
      </div>
      <motion.div
        style={{ x, touchAction: "pan-y" }}
        drag="x"
        dragDirectionLock
        dragSnapToOrigin={!leaving}
        dragElastic={0.6}
        dragConstraints={{ left: 0, right: 0 }}
        animate={leaving ? { x: -480, opacity: 0 } : undefined}
        transition={leaving ? { duration: 0.22, ease: "easeIn" } : undefined}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={onDragEnd}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}

/** The heart ("Super!") and "⋯" with the two swipe actions as buttons (keyboard, screen readers, no-swipe users). */
export function RowActions({ rec, onReact }: { rec: RankedRecommendation; onReact: (rec: RankedRecommendation, r: RowReaction) => void }) {
  const lang = useLang();
  const t = swipeCopy(lang);
  const [open, setOpen] = useState(false);
  const loved = useSwipe((s) => s.log.some((e) => e.rec.id === rec.id && e.reaction === "love"));
  const btn = "relative z-[2] grid size-9 shrink-0 place-items-center rounded-full border border-line bg-card text-ink-soft hover:border-pine/40";
  return (
    <span className="relative z-[2] flex items-center gap-1.5">
      <button type="button" aria-label={t.love} aria-pressed={loved} onClick={() => onReact(rec, "love")} className={cn(btn, loved && "border-clay/40 text-clay")}>
        <Heart className={cn("size-4", loved && "fill-current")} aria-hidden />
      </button>
      <button type="button" aria-label={t.moreActions(rec.city)} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={btn}>
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <span role="group" aria-label={t.moreActions(rec.city)} className="absolute right-0 bottom-11 z-[3] flex gap-1.5 rounded-2xl border border-line bg-card p-1.5 shadow-lift">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onReact(rec, "like");
            }}
            className="flex items-center gap-1 rounded-xl bg-pine-soft px-3 py-2 text-sm font-semibold whitespace-nowrap text-pine-deep"
          >
            <Check className="size-4" aria-hidden /> {t.like}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onReact(rec, "dislike");
            }}
            className="flex items-center gap-1 rounded-xl bg-clay-soft px-3 py-2 text-sm font-semibold whitespace-nowrap text-ink"
          >
            <X className="size-4" aria-hidden /> {t.dislike}
          </button>
        </span>
      )}
    </span>
  );
}

/**
 * What a swipe taught us ("Learned: …", "Undone"), in its own polite live region, separate from the
 * ranking announcements, with "Undo" for the last swipe. It reads the session store, so a ranking
 * update never drops it; a newer toast replaces it, otherwise it stays TOAST_MS.
 */
export function SwipeToast({ onUndo, canUndo }: { onUndo: () => void; canUndo: boolean }) {
  const lang = useLang();
  const t = swipeCopy(lang);
  const toast = useSwipeSession((s) => s.toast);
  const clearToast = useSwipeSession((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => clearToast(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast, clearToast]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ y: 16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="pointer-events-auto flex max-w-[408px] items-start gap-2 rounded-2xl bg-ink px-3.5 py-2.5 text-sm leading-snug text-paper shadow-lift"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden />
            <span className="min-w-0 flex-1">{toast.text}</span>
            {toast.undoable && canUndo && (
              <button
                type="button"
                onClick={onUndo}
                aria-keyshortcuts="Backspace"
                className="-my-1 shrink-0 rounded-lg px-2 py-1 font-semibold text-sun underline-offset-2 hover:underline"
              >
                {t.undo}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Show the new ranking": what the swipes taught us, applied in one refetch (not after every swipe). */
export function PendingRanking() {
  const lang = useLang();
  const t = swipeCopy(lang);
  const pending = useSwipe((s) => s.pending);
  const log = useSwipe((s) => s.log);
  if (!pending || !log.length) return null;
  return (
    <button
      type="button"
      onClick={() => commitLearning()}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-pine/30 bg-pine-soft px-4 py-2.5 text-sm font-semibold text-pine-deep"
    >
      <RefreshCw className="size-4" aria-hidden /> {t.showRanking}
    </button>
  );
}

/** The trips you swiped "Nie dla mnie", one tap away (never hidden silently). */
export function HiddenTrips() {
  const lang = useLang();
  const { fmt } = useT();
  const t = swipeCopy(lang);
  const log = useSwipe((s) => s.log);
  const hidden = log.filter((e) => e.reaction === "dislike");
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!hidden.length) return null;
  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-soft hover:border-clay/40"
      >
        <span className="flex items-center gap-2">
          <EyeOff className="size-4 text-clay" aria-hidden />
          <b className="font-semibold text-ink">{t.hiddenTitle}</b> · {hidden.length} ({open ? t.hide : t.show})
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-clay-soft px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="space-y-2 overflow-hidden pt-3"
          >
            {hidden.map((e) => (
              <li key={e.rec.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-2 pr-3 shadow-soft">
                <CityPhoto rec={e.rec} className="size-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink">{e.rec.city}</p>
                  <p className="tabular text-muted-foreground">
                    {fmt.range(e.rec.window)} · <PriceInline rec={e.rec} />
                  </p>
                </div>
                <button
                  disabled={restoring === e.rec.id}
                  onClick={async () => {
                    setRestoring(e.rec.id);
                    try {
                      await unreact(e);
                      commitLearning(); // list mode: re-rank now, the trip comes back
                    } catch (err) {
                      console.warn("[tripai] restore failed:", err);
                      setError(t.undoFailed(e.rec.city));
                    } finally {
                      setRestoring(null);
                    }
                  }}
                  className="rounded-full border border-pine/30 px-3 py-1.5 text-xs font-semibold text-pine hover:bg-pine-soft disabled:opacity-50"
                >
                  {t.restore}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Hidden ids for the list filter (live: the backend already leaves them out; fixtures: we do). */
export function useHiddenIds(): Set<string> {
  const log = useSwipe((s) => s.log);
  return hiddenIds(log);
}
