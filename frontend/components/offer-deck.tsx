"use client";

import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { Check, Heart, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FLY, SPRING, Stamp, THRESHOLD, VELOCITY } from "@/components/dna-deck";
import { FitBadge } from "@/components/fit-badge";
import { CityPhoto } from "@/components/rec-card";
import { OverallStars } from "@/components/stars";
import type { Lang } from "@/lib/dna";
import { formatPLN, formatRange } from "@/lib/format";
import { swipeCopy, tagLabel, type OfferGesture } from "@/lib/reactions";
import type { RankedRecommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

const KEYS: Record<string, OfferGesture> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" };

function gestureLabel(g: OfferGesture, lang: Lang): string {
  const t = swipeCopy(lang);
  return { right: t.like, left: t.dislike, up: t.love }[g];
}

function OfferFace({ rec, lang, index, total }: { rec: RankedRecommendation; lang: Lang; index: number; total: number }) {
  const t = swipeCopy(lang);
  return (
    <CityPhoto rec={rec} className="absolute inset-0">
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-xs font-medium text-white/85">
        <span className="rounded-full bg-black/30 px-2.5 py-1 backdrop-blur-md">
          {index + 1} {t.of} {total}
        </span>
        {rec.fit && <FitBadge fit={rec.fit} className="bg-paper/90" />}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-6 text-white">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/75">
              {rec.country} · {formatRange(rec.window)}
            </p>
            <p className="font-display text-[2.1rem] leading-[1.05] font-medium">{rec.city}</p>
            <p className="tabular mt-1 text-base text-white/90">
              <b className="font-semibold">{formatPLN(rec.total_cost_pln)}</b> {t.total}
            </p>
          </div>
          <OverallStars total={rec.score.total} size={14} tone="light" className="shrink-0 rounded-full bg-black/40 px-2.5 py-1.5 backdrop-blur-md" />
        </div>
        {!!rec.tags?.length && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="tags">
            {rec.tags.slice(0, 5).map((tag) => (
              <li key={tag} className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs backdrop-blur-sm">
                {tagLabel(tag, lang)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CityPhoto>
  );
}

function TopOffer({
  rec,
  lang,
  index,
  total,
  onSwipe,
}: {
  rec: RankedRecommendation;
  lang: Lang;
  index: number;
  total: number;
  onSwipe: (g: OfferGesture) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-16, 16]);
  const right = useTransform(x, [25, THRESHOLD], [0, 1]);
  const left = useTransform(x, [-THRESHOLD, -25], [1, 0]);
  const up = useTransform(y, [-THRESHOLD, -25], [1, 0]);

  function onDragEnd(_: unknown, info: PanInfo) {
    const { offset: o, velocity: v } = info;
    const horizontal = Math.abs(o.x) >= Math.abs(o.y);
    if (horizontal && (Math.abs(o.x) > THRESHOLD || Math.abs(v.x) > VELOCITY)) onSwipe(o.x > 0 ? "right" : "left");
    else if (!horizontal && o.y < 0 && (Math.abs(o.y) > THRESHOLD || Math.abs(v.y) > VELOCITY)) onSwipe("up");
  }

  return (
    <motion.div
      className="absolute inset-0 cursor-grab touch-none overflow-hidden rounded-[2rem] bg-ink shadow-lift active:cursor-grabbing"
      style={{ x, y, rotate }}
      drag
      dragSnapToOrigin
      dragElastic={0.85}
      dragTransition={{ bounceStiffness: 380, bounceDamping: 24 }}
      onDragEnd={onDragEnd}
      whileTap={{ scale: 1.01 }}
      role="group"
      aria-roledescription="swipe card"
      aria-label={`${rec.city}, ${formatRange(rec.window)}, ${formatPLN(rec.total_cost_pln)}`}
    >
      <OfferFace rec={rec} lang={lang} index={index} total={total} />
      <Stamp g="right" label={gestureLabel("right", lang)} opacity={right} />
      <Stamp g="left" label={gestureLabel("left", lang)} opacity={left} />
      <Stamp g="up" label={gestureLabel("up", lang)} opacity={up} />
    </motion.div>
  );
}

const BUTTONS: { g: OfferGesture; icon: typeof X; tone: string; big?: boolean }[] = [
  { g: "left", icon: X, tone: "text-clay border-clay/30 hover:bg-clay-soft" },
  { g: "up", icon: Heart, tone: "text-ink border-sun/60 bg-sun-soft hover:bg-sun/30", big: true },
  { g: "right", icon: Check, tone: "text-pine border-pine/30 hover:bg-pine-soft" },
];

/**
 * Tinder-style deck of recommendation cards, built from the Travel DNA deck's swipe physics:
 * → "Chcę tam", ← "Nie dla mnie", ↑ "Super!". Buttons and arrow keys do the same; Backspace undoes.
 */
export function OfferDeck({
  cards,
  position,
  lang,
  onSwipe,
  onUndo,
  canUndo,
  undoGesture,
  busy,
}: {
  cards: RankedRecommendation[];
  position: number;
  lang: Lang;
  onSwipe: (rec: RankedRecommendation, g: OfferGesture) => void;
  onUndo: () => void;
  canUndo: boolean;
  /** direction the last swiped card left in (undo flies it back from there) */
  undoGesture: OfferGesture | null;
  busy?: boolean;
}) {
  const card = cards[position];
  const t = swipeCopy(lang);
  const [dir, setDir] = useState<{ g: OfferGesture | null; undo: boolean }>({ g: null, undo: false });

  const swipe = useCallback(
    (g: OfferGesture) => {
      if (!card || busy) return;
      setDir({ g, undo: false });
      onSwipe(card, g);
    },
    [card, busy, onSwipe],
  );
  const undo = useCallback(() => {
    if (!canUndo || busy) return;
    setDir({ g: undoGesture, undo: true });
    onUndo();
  }, [canUndo, busy, undoGesture, onUndo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      // Don't steal keys from other controls; the deck's own buttons keep focus after a tap, so allow those.
      if (!el?.closest("[data-offer-deck]") && el?.closest("input, textarea, select, a, button, [role=radio], [role=radiogroup], [role=slider], [contenteditable]"))
        return;
      if (e.metaKey || e.ctrlKey ? e.key !== "z" : e.altKey) return;
      if (KEYS[e.key]) {
        e.preventDefault();
        swipe(KEYS[e.key]);
      } else if (e.key === "Backspace" || (e.key === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipe, undo]);

  const behind = cards.slice(position + 1, position + 3);

  return (
    <div className="flex flex-col" data-offer-deck>
      <div className="relative mx-auto h-[min(58dvh,520px)] min-h-[380px] w-full">
        {behind
          .map((c, i) => (
            <motion.div
              key={c.id}
              className="absolute inset-0 overflow-hidden rounded-[2rem] bg-ink shadow-soft"
              initial={false}
              animate={{ scale: 1 - (i + 1) * 0.045, y: (i + 1) * 14, opacity: i === 0 ? 1 : 0.7 }}
              transition={SPRING}
              aria-hidden
            >
              <CityPhoto rec={c} className="size-full opacity-80" />
            </motion.div>
          ))
          .reverse()}
        <AnimatePresence custom={dir} initial={false}>
          {card && (
            <motion.div
              key={card.id}
              className="absolute inset-0"
              custom={dir}
              variants={{
                enter: (d: typeof dir) => (d.undo && d.g ? { ...FLY[d.g], opacity: 1 } : { scale: 0.955, y: 14, opacity: 1 }),
                center: { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 },
                exit: (d: typeof dir) => (d.g && !d.undo ? { ...FLY[d.g], opacity: 0.9 } : { scale: 0.955, y: 14, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SPRING}
            >
              <TopOffer rec={card} lang={lang} index={position} total={cards.length} onSwipe={swipe} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-5 flex items-end justify-center gap-3">
        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={undo}
            disabled={!canUndo || busy}
            className="grid size-11 place-items-center rounded-full border border-line bg-card text-ink-soft shadow-soft transition hover:bg-paper-deep disabled:opacity-35"
            aria-label={`${t.undo} (Backspace)`}
          >
            <RotateCcw className="size-4" />
          </button>
          <span className="text-xs text-muted-foreground">{t.undo}</span>
        </div>
        {BUTTONS.map(({ g, icon: Icon, tone, big }) => (
          <div key={g} className="flex w-[4.5rem] flex-col items-center gap-1.5">
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => swipe(g)}
              disabled={!card || busy}
              className={cn(
                "grid place-items-center rounded-full border-2 bg-card shadow-soft transition-colors disabled:opacity-40",
                big ? "size-16" : "size-14",
                tone,
              )}
              aria-label={`${gestureLabel(g, lang)} (${{ left: "←", right: "→", up: "↑" }[g]})`}
            >
              <Icon className={big ? "size-7" : "size-6"} strokeWidth={2.4} />
            </motion.button>
            <span className="text-center text-xs leading-tight font-medium text-ink-soft">{gestureLabel(g, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
