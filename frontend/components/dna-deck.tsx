"use client";

import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { Check, ChevronsDown, RotateCcw, Star, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { gesturesFor, type DnaCard, type Gesture, type Lang } from "@/lib/dna";
import { messagesFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Swipe physics shared with the offer deck (components/offer-deck.tsx). */
export const FLY: Record<Gesture, { x: number; y: number; rotate: number }> = {
  right: { x: 560, y: 40, rotate: 22 },
  left: { x: -560, y: 40, rotate: -22 },
  up: { x: 0, y: -900, rotate: 0 },
  down: { x: 0, y: 900, rotate: 0 },
};
export const SPRING = { type: "spring", stiffness: 320, damping: 30 } as const;
export const THRESHOLD = 95;
export const VELOCITY = 650;

/** What each gesture means on this card, for stamps, buttons and aria labels. */
export function gestureLabel(card: DnaCard, g: Gesture, lang: Lang): string {
  const t = messagesFor(lang).onboarding;
  if (card.kind === "yesno") return g === "right" ? t.yesNo.yes : t.yesNo.no;
  return t.answers[({ left: 1, down: 3, right: 4, up: 5 } as const)[g]];
}

const STAMP_STYLE: Record<Gesture, string> = {
  right: "left-5 top-6 -rotate-12 border-pine text-pine bg-paper/90",
  left: "right-5 top-6 rotate-12 border-clay text-clay bg-paper/90",
  up: "left-1/2 bottom-40 -translate-x-1/2 -rotate-3 border-sun text-ink bg-sun-soft/95",
  down: "left-1/2 top-6 -translate-x-1/2 border-sky text-sky bg-paper/90",
};

export function Stamp({ g, label, opacity }: { g: Gesture; label: string; opacity: ReturnType<typeof useTransform<number, number>> }) {
  return (
    <motion.span
      style={{ opacity }}
      className={cn(
        "pointer-events-none absolute z-20 rounded-xl border-[3px] px-3 py-1 font-display text-2xl font-semibold tracking-wide uppercase shadow-soft",
        STAMP_STYLE[g],
      )}
    >
      {label}
    </motion.span>
  );
}

function CardFace({ card, lang, index, total }: { card: DnaCard; lang: Lang; index: number; total: number }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={card.image} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-cover select-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-xs font-medium text-white/85">
        <span className="rounded-full bg-black/30 px-2.5 py-1 backdrop-blur-md">
          {index + 1} / {total}
        </span>
        {card.kind === "yesno" && (
          <span className="rounded-full bg-paper/90 px-2.5 py-1 text-ink">{messagesFor(lang).onboarding.yesNoBadge}</span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-6 text-white">
        <p className="font-display text-[1.85rem] leading-[1.12] font-medium text-balance">{card.text[lang]}</p>
      </div>
    </>
  );
}

function TopCard({
  card,
  lang,
  index,
  total,
  onSwipe,
}: {
  card: DnaCard;
  lang: Lang;
  index: number;
  total: number;
  onSwipe: (g: Gesture) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-16, 16]);
  const right = useTransform(x, [25, THRESHOLD], [0, 1]);
  const left = useTransform(x, [-THRESHOLD, -25], [1, 0]);
  const up = useTransform(y, [-THRESHOLD, -25], [1, 0]);
  const down = useTransform(y, [25, THRESHOLD], [0, 1]);
  const allowed = gesturesFor(card);
  const yesno = card.kind === "yesno";

  function onDragEnd(_: unknown, info: PanInfo) {
    const { offset: o, velocity: v } = info;
    const horizontal = Math.abs(o.x) >= Math.abs(o.y) || yesno;
    let g: Gesture | null = null;
    if (horizontal && (Math.abs(o.x) > THRESHOLD || Math.abs(v.x) > VELOCITY)) g = o.x > 0 ? "right" : "left";
    else if (!horizontal && (Math.abs(o.y) > THRESHOLD || Math.abs(v.y) > VELOCITY)) g = o.y > 0 ? "down" : "up";
    if (g && allowed.includes(g)) onSwipe(g);
  }

  return (
    <motion.div
      className="absolute inset-0 cursor-grab touch-none overflow-hidden rounded-[2rem] bg-ink shadow-lift active:cursor-grabbing"
      style={{ x, y, rotate }}
      drag={yesno ? "x" : true}
      dragSnapToOrigin
      dragElastic={0.85}
      dragTransition={{ bounceStiffness: 380, bounceDamping: 24 }}
      onDragEnd={onDragEnd}
      whileTap={{ scale: 1.01 }}
      role="group"
      aria-roledescription="swipe card"
      aria-label={card.text[lang]}
    >
      <CardFace card={card} lang={lang} index={index} total={total} />
      {allowed.includes("right") && <Stamp g="right" label={gestureLabel(card, "right", lang)} opacity={right} />}
      {allowed.includes("left") && <Stamp g="left" label={gestureLabel(card, "left", lang)} opacity={left} />}
      {allowed.includes("up") && <Stamp g="up" label={gestureLabel(card, "up", lang)} opacity={up} />}
      {allowed.includes("down") && <Stamp g="down" label={gestureLabel(card, "down", lang)} opacity={down} />}
    </motion.div>
  );
}

const BUTTONS: { g: Gesture; icon: typeof X; tone: string; big?: boolean }[] = [
  { g: "left", icon: X, tone: "text-clay border-clay/30 hover:bg-clay-soft" },
  { g: "down", icon: ChevronsDown, tone: "text-sky border-sky/30 hover:bg-sky-soft" },
  { g: "up", icon: Star, tone: "text-ink border-sun/60 bg-sun-soft hover:bg-sun/30", big: true },
  { g: "right", icon: Check, tone: "text-pine border-pine/30 hover:bg-pine-soft" },
];

/**
 * Stack of swipe cards. Swipe or drag (left / down / right / up), use the buttons,
 * or the arrow keys; Backspace undoes. Cards fly out in the swiped direction and
 * fly back in from the same side on undo.
 */
export function DnaDeck({
  cards,
  position,
  lang,
  onAnswer,
  onUndo,
  undoGesture,
}: {
  cards: DnaCard[];
  position: number;
  lang: Lang;
  onAnswer: (card: DnaCard, g: Gesture) => void;
  onUndo: () => void;
  /** direction the most recent answer left in (the card undo brings back) */
  undoGesture: Gesture | null;
}) {
  const card = cards[position];
  const [dir, setDir] = useState<{ g: Gesture | null; undo: boolean }>({ g: null, undo: false });

  const swipe = useCallback(
    (g: Gesture) => {
      if (!card || !gesturesFor(card).includes(g)) return;
      setDir({ g, undo: false });
      onAnswer(card, g);
    },
    [card, onAnswer],
  );
  const undo = useCallback(() => {
    if (position === 0) return;
    setDir({ g: undoGesture, undo: true });
    onUndo();
  }, [position, undoGesture, onUndo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't steal keys from focused controls (language toggle, links, buttons, radios).
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, a, button, [role=radio], [role=radiogroup], [role=checkbox], [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey ? e.key !== "z" : e.altKey) return;
      const map: Record<string, Gesture> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      if (map[e.key]) {
        e.preventDefault();
        swipe(map[e.key]);
      } else if (e.key === "Backspace" || (e.key === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipe, undo]);

  const behind = cards.slice(position + 1, position + 3);
  const gestures = card ? gesturesFor(card) : [];

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative mx-auto h-[min(62dvh,560px)] min-h-[400px] w-full">
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.image} alt="" className="size-full object-cover opacity-80" />
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
              <TopCard card={card} lang={lang} index={position} total={cards.length} onSwipe={swipe} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-6 flex items-end justify-center gap-3">
        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={undo}
            disabled={position === 0}
            className="grid size-11 place-items-center rounded-full border border-line bg-card text-ink-soft shadow-soft transition hover:bg-paper-deep disabled:opacity-35"
            aria-label={messagesFor(lang).onboarding.undo}
          >
            <RotateCcw className="size-4" />
          </button>
          <span className="text-xs text-muted-foreground">{messagesFor(lang).onboarding.undo}</span>
        </div>
        {BUTTONS.filter((b) => gestures.includes(b.g)).map(({ g, icon: Icon, tone, big }) => (
          <div key={g} className="flex w-16 flex-col items-center gap-1.5">
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => swipe(g)}
              className={cn(
                "grid place-items-center rounded-full border-2 bg-card shadow-soft transition-colors",
                big ? "size-16" : "size-14",
                tone,
              )}
              aria-label={`${card ? gestureLabel(card, g, lang) : ""} (${{ left: "←", right: "→", up: "↑", down: "↓" }[g]})`}
            >
              <Icon className={big ? "size-7" : "size-6"} strokeWidth={2.4} />
            </motion.button>
            <span className="text-center text-xs leading-tight font-medium text-ink-soft">{card && gestureLabel(card, g, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
