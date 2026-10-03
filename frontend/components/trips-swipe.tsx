"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, EyeOff, LayoutList, Layers, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfferDeck } from "@/components/offer-deck";
import { CityPhoto } from "@/components/rec-card";
import { formatPLN, formatRange } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { GESTURE_REACTION, swipeCopy, toastText, type OfferGesture } from "@/lib/reactions";
import type { RankedRecommendation } from "@/lib/types";
import { commitLearning, currentBase, hiddenIds, react, unreact, useSwipe, type SwipeEntry } from "@/lib/use-reactions";
import { cn } from "@/lib/utils";

const REACTION_GESTURE: Record<SwipeEntry["reaction"], OfferGesture> = { like: "right", dislike: "left", love: "up" };


/** "Swipe" / "List" switch on /trips. Leaving the deck commits what it learned (one re-rank). */
export function TripsViewToggle({ className }: { className?: string }) {
  const lang = useLang();
  const t = swipeCopy(lang);
  const view = useSwipe((s) => s.view);
  const setView = useSwipe((s) => s.setView);
  const options = [
    { v: "list" as const, label: t.list, icon: LayoutList },
    { v: "swipe" as const, label: t.swipe, icon: Layers },
  ];
  return (
    <div data-tour="swipe-toggle" role="group" aria-label={t.viewLabel} className={cn("inline-flex rounded-full border border-line bg-card p-1 shadow-soft", className)}>
      {options.map(({ v, label, icon: Icon }) => (
        <button
          key={v}
          aria-pressed={view === v}
          onClick={() => {
            if (v === "list") commitLearning();
            setView(v);
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
            view === v ? "bg-ink text-paper" : "text-ink-soft hover:text-ink",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Tiny toast that says what a swipe taught us. One at a time; the newest replaces the last. */
function LearnToast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const id = setTimeout(onDone, 3600);
    return () => clearTimeout(id);
  }, [text, onDone]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {text && (
          <motion.p
            key={text}
            initial={{ y: 16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="flex max-w-[408px] items-start gap-2 rounded-2xl bg-ink px-3.5 py-2.5 text-sm leading-snug text-paper shadow-lift"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden />
            {text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Swipe mode: the ranked cards you haven't reacted to, as a deck. Each swipe goes to POST /reactions
 * (right/up also watch the price via T5b /picks); the learned profile is applied when you leave.
 */
export function SwipeMode({ ranked, refining }: { ranked: RankedRecommendation[]; refining: boolean }) {
  const lang = useLang();
  const t = swipeCopy(lang);
  const log = useSwipe((s) => s.log);
  const setView = useSwipe((s) => s.setView);
  // Snapshot the deck when it opens: later refetches must not reshuffle cards under your thumb.
  const [cards, setCards] = useState<RankedRecommendation[] | null>(null);
  const [position, setPosition] = useState(0);
  const [history, setHistory] = useState<SwipeEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // an undo is running
  const [saving, setSaving] = useState(0); // swipes not yet confirmed by the backend
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (cards || refining || !ranked.length) return;
    const seen = new Set(useSwipe.getState().log.map((e) => e.rec.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time snapshot once the list is final
    setCards(ranked.filter((r) => !seen.has(r.id)));
  }, [cards, refining, ranked]);

  // Leaving /trips with the deck open still keeps what it learned.
  useEffect(() => () => commitLearning(), []);

  const onSwipe = useCallback(
    (rec: RankedRecommendation, g: OfferGesture) => {
      setPosition((p) => p + 1);
      setSaving((n) => n + 1);
      // swipes are applied in order (each builds on the previous one's profile)
      inFlight.current = inFlight.current
        .then(async () => {
          const personalized = currentBase().profile.personalize !== false;
          const entry = await react(rec, GESTURE_REACTION[g]);
          setHistory((h) => [...h, entry]);
          setToast(toastText(entry.res, lang, { personalized, watch: entry.watch }));
        })
        .catch((err) => {
          // not saved (or unknown): never pretend it was. The card goes back to the end of the deck.
          console.warn("[tripai] swipe not saved:", err);
          setCards((c) => (c ? [...c, rec] : c));
          setToast(swipeCopy(lang).swipeFailed(rec.city));
        })
        .finally(() => setSaving((n) => n - 1));
    },
    [lang],
  );

  const onUndo = useCallback(() => {
    const last = history.at(-1);
    // Undo only once every swipe is confirmed: otherwise "last" may not be the card on screen.
    if (!last || saving > 0) return;
    setBusy(true);
    inFlight.current = inFlight.current
      .then(() => unreact(last))
      .then(() => {
        setHistory((h) => h.filter((e) => e !== last));
        setPosition((p) => Math.max(0, p - 1));
        setToast(t.undone(last.rec.city));
      })
      .catch((err) => {
        console.warn("[tripai] undo failed:", err);
        setToast(t.undoFailed(last.rec.city)); // the swipe still stands, and we say so
      })
      .finally(() => setBusy(false));
  }, [history, saving, t]);

  const done = cards !== null && position >= cards.length;
  const lastGesture = history.at(-1) ? REACTION_GESTURE[history.at(-1)!.reaction] : null;

  return (
    <section className="mt-4" aria-label={t.swipe}>
      {cards === null ? (
        <p className="rounded-2xl bg-paper-deep px-4 py-3 text-sm text-ink-soft">{refining ? t.refining : t.empty}</p>
      ) : done ? (
        <div className="rounded-[2rem] border border-line bg-card p-6 text-center shadow-soft">
          <p className="font-display text-2xl font-medium text-ink">{cards.length ? t.doneTitle : t.empty}</p>
          {history.length > 0 && <p className="mt-2 text-sm text-ink-soft">{t.doneBody(history.length)}</p>}
          <div className="mt-5 flex justify-center gap-2">
            {history.length > 0 && (
              <button onClick={onUndo} disabled={busy || saving > 0} className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper-deep">
                {t.undo}
              </button>
            )}
            <button
              onClick={() => {
                commitLearning();
                setView("list");
              }}
              className="rounded-full bg-pine px-4 py-2 text-sm font-semibold text-paper hover:bg-pine-deep"
            >
              {t.showRanking}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">{t.hint}</p>
          <OfferDeck
            cards={cards}
            position={position}
            lang={lang}
            onSwipe={onSwipe}
            onUndo={onUndo}
            canUndo={history.length > 0 && saving === 0}
            undoGesture={lastGesture}
            busy={busy}
          />
          {log.length > 0 && <p className="mt-4 text-center text-xs text-muted-foreground">{t.pendingNote}</p>}
        </>
      )}
      <LearnToast text={toast} onDone={() => setToast(null)} />
    </section>
  );
}

/** List mode: the trips you swiped "Nie dla mnie", one tap away (never hidden silently). */
export function HiddenTrips() {
  const lang = useLang();
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
                    {formatRange(e.rec.window)} · {formatPLN(e.rec.total_cost_pln)}
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
