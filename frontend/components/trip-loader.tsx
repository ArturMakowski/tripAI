"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, Plane } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What the backend pipeline does while you wait. A step only gets a ✓ from a real
 * signal (e.g. the free windows actually loaded); everything else is shown as
 * "working" until the response itself replaces the loader. No fake progress.
 */
export interface Stage {
  label: string;
  done?: boolean; // only from real data
}

const ROUTE = "M 22 74 Q 150 -18 298 40";
// lucide "plane" glyph, 24x24
const PLANE =
  "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z";

/** SVG-native animation so it scales with the card (no fixed pixel width). */
function RouteAnimation({ origin, reduce }: { origin: string; reduce: boolean }) {
  return (
    <svg viewBox="0 0 320 92" className="mx-auto block h-auto w-full max-w-[320px]" aria-hidden>
      <path d={ROUTE} fill="none" stroke="var(--line)" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />
      <circle cx="22" cy="74" r="5" fill="var(--pine)" />
      <circle cx="298" cy="40" r="5" fill="var(--clay)" />
      {!reduce && (
        <circle cx="298" cy="40" r="5" fill="none" stroke="var(--clay)" strokeWidth="2">
          <animate attributeName="r" values="5;16" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      <text x="22" y="90" textAnchor="middle" className="fill-ink-soft font-mono text-[10px] font-semibold">
        {origin}
      </text>
      <g transform={reduce ? "translate(160 22)" : undefined}>
        {!reduce && <animateMotion dur="2.8s" repeatCount="indefinite" rotate="auto" path={ROUTE} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1" />}
        <circle r="13" fill="var(--ink)" />
        {/* glyph points up-right; rotate so it faces along the path */}
        <path d={PLANE} transform="rotate(45) scale(0.62) translate(-12 -12)" fill="none" stroke="var(--paper)" strokeWidth="2" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function StepRow({ stage }: { stage: Stage }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          stage.done ? "bg-pine text-paper" : "border-2 border-pine/40",
        )}
      >
        {stage.done ? (
          <Check className="size-3" strokeWidth={3} />
        ) : (
          <span className="size-1.5 animate-pulse rounded-full bg-pine motion-reduce:animate-none" />
        )}
      </span>
      <span className={stage.done ? "text-ink" : "text-ink-soft"}>{stage.label}</span>
    </li>
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

/** Nothing on screen yet: route animation, what the pipeline is doing, skeleton cards. */
export function TripLoader({ origin, title, stages, upNext }: { origin: string; title: string; stages: Stage[]; upNext?: string }) {
  const reduce = !!useReducedMotion();
  return (
    <div aria-hidden>
      <div className="rounded-3xl border border-line bg-card px-5 pt-4 pb-5 shadow-soft">
        <RouteAnimation origin={origin} reduce={reduce} />
        <p className="mt-2 mb-3 font-display text-lg text-ink">{title}</p>
        <ul className="space-y-2.5">
          {stages.map((s) => (
            <StepRow key={s.label} stage={s} />
          ))}
        </ul>
        {upNext && <p className="mt-3 border-t border-dashed border-line pt-3 text-xs text-muted-foreground">Next: {upNext}</p>}
      </div>
      <div className="mt-5 space-y-4">
        <SkeletonCard />
        <SkeletonCard delay={0.15} />
      </div>
    </div>
  );
}

/** Cards on screen with cached prices; a description of what's still being refined (not a fake ticker). */
export function RefiningStrip({ title, detail, tag }: { title: string; detail: string; tag: string }) {
  return (
    <div
      aria-hidden
      className="sheen flex h-[58px] items-center gap-3 rounded-2xl border border-pine/20 bg-pine-soft px-3.5 text-sm text-pine-deep"
    >
      <Plane className="size-4 shrink-0 motion-safe:animate-pulse" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="truncate text-xs text-pine-deep/80">{detail}</p>
      </div>
      <span className="shrink-0 rounded-full bg-card/80 px-2 py-0.5 text-xs font-medium text-ink-soft">{tag}</span>
    </div>
  );
}
