"use client";

import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTutorial, type TourKey } from "@/lib/tutorial-store";
import { useFocusTrap, useTutorialLang } from "./a11y";
import { TOURS, TUTORIAL_COPY } from "./strings";

/** How long to wait for an anchor: the first one may sit behind a loader, later ones are already on screen. */
const FIRST_WAIT_MS = 15_000;
const NEXT_WAIT_MS = 2_500;
const POLL_MS = 250;
const PAD = 6;
const TIP_W = 320;
const GAP = 12;

function findAnchor(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Resolves the first visible `[data-tour=name]`, polling until `timeout`; null if it never shows up. */
function waitForAnchor(name: string, timeout: number, signal: { cancelled: boolean }): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (signal.cancelled) return resolve(null);
      const el = findAnchor(name);
      if (el || Date.now() - start >= timeout) return resolve(el);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

type Rect = { top: number; left: number; width: number; height: number };

/**
 * One-time coach marks for a screen: a spotlight on each anchor in turn with a short tip.
 * "Next"/"Got it" advances, "Hide tips", ✕ or Esc dismisses the whole screen's tour; both are
 * remembered. Anchors that never render (e.g. no fit badge yet) are skipped, and if none render
 * the tour stays unseen for next time.
 */
export function CoachMarks({ tour }: { tour: TourKey }) {
  const steps = TOURS[tour];
  const markSeen = useTutorial((s) => s.markTourSeen);
  const lang = useTutorialLang("screen");
  const t = TUTORIAL_COPY[lang].coach;
  const reduced = !!useReducedMotion();
  const [index, setIndex] = useState(-1);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const shown = useRef(0);

  // Find the next step whose anchor exists, starting at `from`.
  const advance = useCallback(
    (from: number, signal: { cancelled: boolean }) => {
      (async () => {
        for (let i = from; i < steps.length; i++) {
          const el = await waitForAnchor(steps[i].anchor, i === 0 && shown.current === 0 ? FIRST_WAIT_MS : NEXT_WAIT_MS, signal);
          if (signal.cancelled) return;
          if (el) {
            el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
            shown.current += 1;
            setAnchor(el);
            setIndex(i);
            return;
          }
        }
        setAnchor(null);
        setIndex(-1);
        if (shown.current > 0) markSeen(tour);
      })();
    },
    [steps, reduced, markSeen, tour],
  );

  const signal = useRef({ cancelled: false });
  useEffect(() => {
    const s = { cancelled: false };
    signal.current = s;
    // Let the page's own entrance animations settle before pointing at things.
    const id = setTimeout(() => advance(0, s), 700);
    return () => {
      s.cancelled = true;
      clearTimeout(id);
    };
  }, [advance]);

  // Follow the anchor through scrolling, resizing and layout animations.
  useEffect(() => {
    if (!anchor) return;
    let raf = 0;
    const loop = () => {
      if (!anchor.isConnected) {
        const again = findAnchor(steps[index]?.anchor ?? "");
        if (again) setAnchor(again);
        else setRect(null);
      } else {
        const r = anchor.getBoundingClientRect();
        setRect((p) => (p && p.top === r.top && p.left === r.left && p.width === r.width && p.height === r.height ? p : { top: r.top, left: r.left, width: r.width, height: r.height }));
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [anchor, index, steps]);

  const active = index >= 0 && !!anchor;
  useFocusTrap(tipRef, active);

  useEffect(() => {
    if (active) tipRef.current?.focus({ preventScroll: true });
  }, [active, index]);

  const next = () => {
    setAnchor(null);
    advance(index + 1, signal.current);
  };
  const dismiss = () => {
    signal.current.cancelled = true;
    setAnchor(null);
    setIndex(-1);
    markSeen(tour);
  };

  if (!active || !rect) return null;

  const mark = t.marks[steps[index].anchor];
  const remaining = steps.slice(index + 1).length;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const col = document.querySelector("main")?.getBoundingClientRect();
  const colLeft = col?.left ?? 0;
  const colRight = col?.right ?? vw;
  const width = Math.min(TIP_W, colRight - colLeft - 32);
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, colLeft + 16), colRight - 16 - width);
  const below = vh - (rect.top + rect.height) > 210 || rect.top < 210;
  const tipPos = below ? { top: Math.min(rect.top + rect.height + PAD + GAP, vh - 200) } : { bottom: vh - rect.top + PAD + GAP };

  return (
    <div className="fixed inset-0 z-[55]" onClick={next}>
      <div
        aria-hidden
        className="pointer-events-none fixed rounded-2xl ring-2 ring-sun"
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          boxShadow: "0 0 0 9999px oklch(0.24 0.025 165 / 0.55)",
        }}
      />
      <motion.div
        key={steps[index].anchor}
        ref={tipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            dismiss();
          }
        }}
        className="fixed rounded-2xl bg-card p-4 shadow-lift ring-1 ring-line outline-none"
        style={{ left, width, ...tipPos }}
        initial={reduced ? false : { opacity: 0, y: below ? -6 : 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-start gap-2">
          <h2 id={titleId} className="flex-1 font-display text-lg leading-snug text-ink">
            {mark.title}
          </h2>
          <button type="button" onClick={dismiss} aria-label={t.hide} className="-mt-2 -mr-2.5 grid size-10 place-items-center rounded-full text-ink-soft hover:bg-paper-deep">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p id={bodyId} className="mt-1 text-sm leading-relaxed text-ink-soft">
          {mark.body}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          {steps.length > 1 ? (
            <button type="button" onClick={dismiss} className="min-h-10 rounded-full px-1 text-sm text-muted-foreground hover:text-ink">
              {t.hide}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {steps.length > 1 && <span className="text-xs text-muted-foreground tabular-nums">{t.stepOf(index + 1, steps.length)}</span>}
            <Button size="sm" className="h-10 rounded-xl px-4" onClick={remaining ? next : dismiss}>
              {remaining ? t.next : t.gotIt}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
