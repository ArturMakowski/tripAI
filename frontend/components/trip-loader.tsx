"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Plane } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Pipeline stages, in the order the backend does the work. Steps advance on a gentle
 * timer for feedback, but the last step of each phase stays "in progress" until that
 * phase's response actually arrives, so the screen never claims work that isn't done.
 */
export interface Stage {
  label: string;
  done?: string; // wording once finished
}

function useStageIndex(count: number, stepMs: number, reduce: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, count - 1)), stepMs);
    return () => clearInterval(t);
  }, [count, stepMs, reduce]);
  // reduced motion: no ticking; show everything as one in-progress list
  return reduce ? 0 : i;
}

const ROUTE = "M 22 74 Q 150 -18 298 40";

function RouteAnimation({ origin, reduce }: { origin: string; reduce: boolean }) {
  return (
    <div className="relative mx-auto h-[92px] w-[320px]" aria-hidden>
      <svg viewBox="0 0 320 92" width="320" height="92" className="absolute inset-0">
        <path d={ROUTE} fill="none" stroke="var(--line)" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />
        <circle cx="22" cy="74" r="5" fill="var(--pine)" />
        <circle cx="298" cy="40" r="5" fill="var(--clay)" />
        {!reduce && (
          <motion.circle
            cx="298"
            cy="40"
            r="5"
            fill="none"
            stroke="var(--clay)"
            strokeWidth="2"
            animate={{ r: [5, 16], opacity: [0.7, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <text x="22" y="90" textAnchor="middle" className="fill-ink-soft font-mono text-[10px] font-semibold">
          {origin}
        </text>
      </svg>
      <motion.div
        className="absolute top-0 left-0 grid size-7 place-items-center rounded-full bg-ink text-paper shadow-soft"
        style={{ offsetPath: `path("${ROUTE}")`, offsetRotate: "auto 45deg", offsetAnchor: "center" }}
        initial={{ offsetDistance: reduce ? "55%" : "0%" }}
        animate={reduce ? undefined : { offsetDistance: ["0%", "100%"] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: [0.45, 0, 0.55, 1], repeatDelay: 0.3 }}
      >
        <Plane className="size-3.5" />
      </motion.div>
    </div>
  );
}

function StepRow({ stage, state }: { stage: Stage; state: "done" | "active" | "pending" }) {
  return (
    <motion.li layout className="flex items-center gap-3 text-sm">
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          state === "done" && "bg-pine text-paper",
          state === "active" && "border-2 border-pine",
          state === "pending" && "border border-line",
        )}
      >
        {state === "done" && <Check className="size-3" strokeWidth={3} />}
        {state === "active" && <span className="size-1.5 animate-pulse rounded-full bg-pine motion-reduce:animate-none" />}
      </span>
      <span className={cn(state === "pending" ? "text-muted-foreground" : "text-ink", state === "active" && "font-medium")}>
        {state === "done" ? (stage.done ?? stage.label) : stage.label}
        {state === "active" && "…"}
      </span>
    </motion.li>
  );
}

export function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="overflow-hidden rounded-[1.75rem] border border-line bg-card"
      aria-hidden
    >
      <div className="sheen h-40 bg-paper-deep" />
      <div className="space-y-2.5 p-4">
        <div className="flex justify-between">
          <div className="sheen h-5 w-28 rounded bg-paper-deep" />
          <div className="sheen h-6 w-24 rounded bg-paper-deep" />
        </div>
        <div className="sheen h-2.5 w-full rounded-full bg-paper-deep" />
        <div className="sheen h-3 w-2/3 rounded bg-paper-deep" />
      </div>
    </motion.div>
  );
}

/** Phase 1: nothing on screen yet. Route animation + staged steps + skeleton cards. */
export function TripLoader({ origin, stages, upNext }: { origin: string; stages: Stage[]; upNext: string }) {
  const reduce = !!useReducedMotion();
  const i = useStageIndex(stages.length, 900, reduce);
  return (
    <div role="status" aria-live="polite" aria-label="Finding trips for you">
      <div className="rounded-3xl border border-line bg-card px-5 pt-4 pb-5 shadow-soft">
        <RouteAnimation origin={origin} reduce={reduce} />
        <ul className="mt-3 space-y-2.5">
          {stages.map((s, k) => (
            <StepRow key={s.label} stage={s} state={reduce ? "active" : k < i ? "done" : k === i ? "active" : "pending"} />
          ))}
        </ul>
        <p className="mt-3 border-t border-dashed border-line pt-3 text-xs text-muted-foreground">Next: {upNext}</p>
      </div>
      <div className="mt-5 space-y-4">
        <SkeletonCard />
        <SkeletonCard delay={0.15} />
      </div>
    </div>
  );
}

/** Phase 2: cards are on screen with cached prices; exact live prices on the way. */
export function RefiningStrip({ steps }: { steps: string[] }) {
  const reduce = !!useReducedMotion();
  const i = useStageIndex(steps.length, 1100, reduce);
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      role="status"
      aria-live="polite"
      className="sheen flex items-center gap-3 rounded-2xl border border-pine/20 bg-pine-soft px-3.5 py-2.5 text-sm text-pine-deep"
    >
      <Plane className="size-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Refining live prices…</p>
        <div className="relative h-4 overflow-hidden text-xs text-pine-deep/80">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={reduce ? "all" : i}
              className="absolute inset-0 truncate"
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
            >
              {reduce ? steps.join(" · ") : steps[i]}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
      <span className="shrink-0 rounded-full bg-card/80 px-2 py-0.5 text-xs font-medium text-ink-soft">cached prices shown</span>
    </motion.div>
  );
}
