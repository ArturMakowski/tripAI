"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, EyeOff, LayoutList, Layers, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfferDeck } from "@/components/offer-deck";
import { CityPhoto } from "@/components/rec-card";
import { PriceInline } from "@/components/money";
import { useLang, useT } from "@/lib/i18n";
import { GESTURE_REACTION, swipeCopy, toastText, type OfferGesture } from "@/lib/reactions";
import type { RankedRecommendation } from "@/lib/types";
import { TOAST_MS, useDeckSession } from "@/lib/deck-session";
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

/**
 * What a swipe taught us ("Learned: …", "Undone"), in its own live region, separate from the ranking
 * announcements. It reads the deck session, so a ranking update or a deck remount never drops it;
 * a newer toast replaces it, otherwise it stays TOAST_MS. Render it once per page (outside the deck).
 */
export function SwipeToast() {
  const toast = useDeckSession((s) => s.toast);
  const clearToast = useDeckSession((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => clearToast(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast, clearToast]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {toast && (
          <motion.p
            key={toast.id}
            initial={{ y: 16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="flex max-w-[408px] items-start gap-2 rounded-2xl bg-ink px-3.5 py-2.5 text-sm leading-snug text-paper shadow-lift"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-sun" aria-hidden />
            {toast.text}
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
  // The deck lives in the session store (lib/deck-session.ts): the snapshot is taken once the ranking is
  // final, and a later ranking update or a remount never reshuffles it or drops the toast/undo history.
  const { cards, position, history, offer, advance, back, pushBack, remember, forget, showToast } = useDeckSession();
  const [busy, setBusy] = useState(false); // an undo is running
  const [saving, setSaving] = useState(0); // swipes not yet confirmed by the backend
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    offer(ranked, refining, new Set(useSwipe.getState().log.map((e) => e.rec.id)));
  }, [offer, refining, ranked]);

  const onSwipe = useCallback(
    (rec: RankedRecommendation, g: OfferGesture) => {
      advance();
      setSaving((n) => n + 1);
      // swipes are applied in order (each builds on the previous one's profile)
      inFlight.current = inFlight.current
        .then(async () => {
          const personalized = currentBase().profile.personalize !== false;
          const entry = await react(rec, GESTURE_REACTION[g]);
          remember(entry);
          showToast(toastText(entry.res, lang, { personalized, watch: entry.watch }));
        })
        .catch((err) => {
          // not saved (or unknown): never pretend it was. The card goes back to the end of the deck.
          console.warn("[tripai] swipe not saved:", err);
          pushBack(rec);
          showToast(swipeCopy(lang).swipeFailed(rec.city));
        })
        .finally(() => setSaving((n) => n - 1));
    },
    [lang, advance, remember, showToast, pushBack],
  );

  const onUndo = useCallback(() => {
    const last = history.at(-1);
    // Undo only once every swipe is confirmed: otherwise "last" may not be the card on screen.
    if (!last || saving > 0) return;
    setBusy(true);
    inFlight.current = inFlight.current
      .then(() => unreact(last))
      .then(() => {
        forget(last);
        back();
        showToast(t.undone(last.rec.city));
      })
      .catch((err) => {
        console.warn("[tripai] undo failed:", err);
        showToast(t.undoFailed(last.rec.city)); // the swipe still stands, and we say so
      })
      .finally(() => setBusy(false));
  }, [history, saving, t, forget, back, showToast]);

  const done = cards !== null && position >= cards.length;
  const lastGesture = history.at(-1) ? REACTION_GESTURE[history.at(-1)!.reaction] : null;

  return (
    // aria-busy until the ranking is final and the deck snapshot is taken (e2e and screen readers wait on it)
    <section className="mt-4" aria-label={t.swipe} aria-busy={refining || cards === null}>
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
          {/* the deck's buttons say what each direction does; the gesture help is for screen readers */}
          <p className="sr-only">{t.hint}</p>
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
    </section>
  );
}

/** List mode: the trips you swiped "Nie dla mnie", one tap away (never hidden silently). */
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
