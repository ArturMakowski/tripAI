"use client";

/**
 * Small looping illustrations for the intro steps, built from the app's own pieces (DNA card,
 * calendar day cells, ranked trip rows, score ring, fit badge, source tag). Decorative: the step
 * title and body carry the meaning, so every illustration is aria-hidden. Under reduced motion
 * each one renders its final frame, still.
 */
import { motion, type Transition } from "motion/react";
import { BellRing, CalendarHeart, Check, ChevronLeft, ChevronRight, ExternalLink, Hand, Sun } from "lucide-react";
import { ScoreRing } from "@/components/score-ring";
import { cn } from "@/lib/utils";
import type { Messages } from "@/lib/i18n";
import type { IntroStepId } from "./strings";

type ArtProps = { art: Messages["tutorial"]["art"]; reduced: boolean };

const loop = (reduced: boolean, t: Transition): Transition => (reduced ? { duration: 0 } : { repeat: Infinity, ...t });

/** Step 1: a Travel DNA card swiping right with the "That's me" stamp, then coming back. */
function DnaArt({ art: a, reduced }: ArtProps) {
  return (
    <div className="relative mx-auto h-60 w-48">
      <div className="absolute inset-0 translate-y-3 scale-[0.92] rounded-3xl bg-paper-deep shadow-soft" />
      <div className="absolute inset-0 translate-y-1.5 scale-[0.96] rounded-3xl bg-card shadow-soft ring-1 ring-line" />
      <motion.div
        className="absolute inset-0 overflow-hidden rounded-3xl bg-card shadow-lift ring-1 ring-line"
        initial={false}
        animate={reduced ? { x: 18, rotate: 5 } : { x: [0, 0, 70, 0, 0], rotate: [0, 0, 12, 0, 0], opacity: [1, 1, 0.9, 1, 1] }}
        transition={loop(reduced, { duration: 3.2, times: [0, 0.3, 0.55, 0.8, 1], ease: "easeInOut", repeatDelay: 0.4 })}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/swipe/explore.jpg" alt="" className="h-32 w-full object-cover" />
        <p className="p-3 font-display text-[15px] leading-snug text-ink">{a.card}</p>
        <motion.span
          className="absolute top-3 left-3 -rotate-12 rounded-lg border-2 border-pine bg-card/90 px-2 py-0.5 text-sm font-bold tracking-wide text-pine uppercase"
          initial={false}
          animate={reduced ? { opacity: 1 } : { opacity: [0, 0, 1, 0, 0] }}
          transition={loop(reduced, { duration: 3.2, times: [0, 0.3, 0.5, 0.75, 1], repeatDelay: 0.4 })}
        >
          {a.thatsMe}
        </motion.span>
      </motion.div>
      <div className="absolute -bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-3 text-xs font-medium whitespace-nowrap text-ink-soft">
        <span className="inline-flex items-center gap-0.5">
          <ChevronLeft className="size-3.5" /> {a.notMe}
        </span>
        <span className="size-1 rounded-full bg-line" />
        <span className="inline-flex items-center gap-0.5 text-pine">
          {a.thatsMe} <ChevronRight className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

// May 2027 starts on a Saturday; 1 and 3 May and Corpus Christi (Thu 27 May) are public holidays.
const MAY_OFFSET = 5;
const HOLIDAYS = new Set([1, 3, 27]);
const BRIDGE = [27, 28, 29, 30];

/** Step 2: a month with holiday dots; the long weekend fills in and the radar chip pops up. */
function CalendarArt({ art: a, reduced }: ArtProps) {
  const cells = [...Array(MAY_OFFSET).fill(null), ...Array.from({ length: 31 }, (_, i) => i + 1)];
  return (
    <div className="relative mx-auto w-64 rounded-3xl border border-line bg-card p-3.5 shadow-lift">
      <p className="mb-2 flex items-center gap-1.5 font-display text-base text-ink">
        <CalendarHeart className="size-4 text-clay" /> {a.month}
      </p>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[10px] font-medium text-muted-foreground">
        {a.weekdays.map((d) => (
          <span key={d}>{d}</span>
        ))}
        {cells.map((d, i) => {
          const k = BRIDGE.indexOf(d ?? -1);
          const inBridge = k >= 0;
          return (
            <div key={i} className="relative grid h-6 place-items-center">
              {inBridge && (
                <motion.span
                  className={cn("absolute inset-y-0 border-y border-dashed border-sun bg-sun-soft", k === 0 && "left-0.5 rounded-l-full border-l", k === 3 && "right-0.5 rounded-r-full border-r", k > 0 && "left-0", k < 3 && "right-0")}
                  initial={false}
                  animate={reduced ? { opacity: 1 } : { opacity: [0, 0, 1, 1, 0] }}
                  transition={loop(reduced, { duration: 4, times: [0, 0.15 + k * 0.08, 0.25 + k * 0.08, 0.9, 1] })}
                />
              )}
              {d && (
                <span className={cn("relative text-[11px] tabular-nums", inBridge ? "font-semibold text-ink" : "text-ink-soft")}>
                  {d}
                  {HOLIDAYS.has(d) && <span className="absolute -bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-clay" />}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <motion.div
        className="absolute -right-3 -bottom-4 flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium whitespace-nowrap text-paper shadow-lift"
        initial={false}
        animate={reduced ? { opacity: 1, scale: 1 } : { opacity: [0, 0, 1, 1, 0], scale: [0.85, 0.85, 1, 1, 0.95] }}
        transition={loop(reduced, { duration: 4, times: [0, 0.5, 0.6, 0.9, 1] })}
      >
        <Sun className="size-3.5 text-sun" /> {a.bridge}
      </motion.div>
    </div>
  );
}

const ROWS = [
  { photo: "/cities/rome.jpg", price: "1 140", score: 0.86 },
  { photo: "/cities/lisbon.jpg", price: "1 310", score: 0.79 },
  { photo: "/cities/athens.jpg", price: "980", score: 0.74 },
];

/** Step 3: ranked trip rows slide in; the top one shows its source tag and fit badge. */
function ProofArt({ art: a, reduced }: ArtProps) {
  return (
    <div className="mx-auto w-72 space-y-2">
      {ROWS.map((r, i) => (
        <motion.div
          key={r.photo}
          className={cn("flex items-center gap-3 rounded-2xl border border-line bg-card p-2 shadow-soft", i === 0 && "shadow-lift ring-1 ring-pine/25")}
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.15 + i * 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="w-4 text-center font-display text-sm text-muted-foreground">{i + 1}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.photo} alt="" className="size-11 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] leading-tight text-ink">{a.cities[i]}</p>
            <p className="text-xs text-ink-soft tabular-nums">
              {r.price} PLN · {a.nights}
            </p>
            {i === 0 && (
              <motion.div
                className="mt-1 flex flex-wrap items-center gap-1.5"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduced ? 0 : 0.8, duration: 0.4 }}
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-pine px-2 py-0.5 text-[10px] font-semibold text-paper">
                  <span className="size-1.5 rounded-full bg-paper" /> {a.fit}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  {a.source} <ExternalLink className="size-2.5" />
                </span>
              </motion.div>
            )}
          </div>
          <ScoreRing value={r.score} size={38} stroke={4} />
        </motion.div>
      ))}
    </div>
  );
}

/** Step 4: an offer waiting for your approval, plus a rare, relevant alert. */
function DecideArt({ art: a, reduced }: ArtProps) {
  return (
    <div className="relative mx-auto w-64 pt-10">
      <motion.div
        className="absolute top-0 left-1/2 z-10 flex w-60 -translate-x-1/2 items-center gap-2 rounded-2xl bg-ink px-3 py-2 text-xs text-paper shadow-lift"
        initial={false}
        animate={reduced ? { y: 0, opacity: 1 } : { y: [-16, 0, 0, -16], opacity: [0, 1, 1, 0] }}
        transition={loop(reduced, { duration: 4.5, times: [0, 0.12, 0.85, 1], repeatDelay: 0.6 })}
      >
        <BellRing className="size-4 shrink-0 text-sun" />
        <span className="min-w-0 flex-1 truncate">{a.alert}</span>
      </motion.div>
      <div className="mt-6 overflow-hidden rounded-3xl border border-line bg-card shadow-soft">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cities/rome.jpg" alt="" className="h-24 w-full object-cover" />
        <div className="p-3">
          <p className="font-display text-base text-ink">{a.cities[0]}</p>
          <p className="text-xs text-ink-soft">{a.notBooked}</p>
          <div className="relative mt-2.5">
            <motion.div
              className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-pine text-sm font-medium text-paper"
              initial={false}
              animate={reduced ? { scale: 1 } : { scale: [1, 1, 0.95, 1, 1] }}
              transition={loop(reduced, { duration: 4.5, times: [0, 0.5, 0.58, 0.66, 1], repeatDelay: 0.6 })}
            >
              <Check className="size-4" /> {a.approve}
            </motion.div>
            <motion.span
              className="absolute -right-1 -bottom-4 text-ink"
              initial={false}
              animate={reduced ? { x: 0, y: 0 } : { x: [24, 24, 0, 0, 24], y: [16, 16, 0, 0, 16], opacity: [0, 0, 1, 1, 0] }}
              transition={loop(reduced, { duration: 4.5, times: [0, 0.3, 0.5, 0.8, 1], repeatDelay: 0.6 })}
            >
              <Hand className="size-6 fill-card" />
            </motion.span>
          </div>
        </div>
      </div>
      <p className="mt-6 text-center text-xs font-medium text-ink-soft">
        <BellRing className="mr-1 inline size-3.5 text-clay" /> {a.alertOnly}
      </p>
    </div>
  );
}

const ART: Record<IntroStepId, (p: ArtProps) => React.ReactElement> = {
  dna: DnaArt,
  calendar: CalendarArt,
  proof: ProofArt,
  decide: DecideArt,
};

/** Steps whose art shows prices or a source: labelled so made-up numbers never pass for sourced ones. */
const SHOWS_NUMBERS = new Set<IntroStepId>(["proof", "decide"]);

export function IntroArt({ step, ...p }: ArtProps & { step: IntroStepId }) {
  const Art = ART[step];
  return (
    <div className="relative grid h-80 place-items-center">
      <div aria-hidden className="contents">
        <Art {...p} />
      </div>
      {SHOWS_NUMBERS.has(step) && (
        <span aria-hidden className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full border border-dashed border-line bg-card px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {p.art.example}
        </span>
      )}
    </div>
  );
}
