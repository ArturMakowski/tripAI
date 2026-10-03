"use client";

import { motion } from "motion/react";
import { CloudSun, Users, Wallet, Sparkles, type LucideIcon } from "lucide-react";
import { FACTOR_LABEL, FACTORS, normalise, type Factor } from "@/lib/scoring";
import type { ScoreBreakdown, Weights } from "@/lib/types";
import { cn } from "@/lib/utils";

export const FACTOR_COLOR: Record<Factor, string> = {
  price: "var(--pine)",
  weather: "var(--sun)",
  crowds: "var(--sky)",
  taste: "var(--clay)",
};

export const FACTOR_ICON: Record<Factor, LucideIcon> = {
  price: Wallet,
  weather: CloudSun,
  crowds: Users,
  taste: Sparkles,
};

const spring = { type: "spring", stiffness: 140, damping: 22 } as const;

/** Stacked contribution bar: each segment = weight x factor score, total = overall score. */
export function ContributionBar({ score, weights, className }: { score: ScoreBreakdown; weights: Weights; className?: string }) {
  const n = normalise(weights);
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-paper-deep", className)}>
      {FACTORS.map((f) => (
        <motion.div
          key={f}
          className="h-full first:rounded-l-full"
          style={{ background: FACTOR_COLOR[f] }}
          initial={false}
          animate={{ width: `${n[f] * score[f] * 100}%` }}
          transition={spring}
        />
      ))}
    </div>
  );
}

/** Per-factor rows: score bar, weight share and points contributed. */
export function FactorBars({ score, weights }: { score: ScoreBreakdown; weights: Weights }) {
  const n = normalise(weights);
  return (
    <ul className="space-y-3.5">
      {FACTORS.map((f) => {
        const Icon = FACTOR_ICON[f];
        const pts = n[f] * score[f] * 100;
        return (
          <li key={f}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-ink">
                <Icon className="size-4" style={{ color: FACTOR_COLOR[f] }} aria-hidden />
                {FACTOR_LABEL[f]}
                <span className="tabular text-xs font-normal text-muted-foreground">
                  {Math.round(score[f] * 100)}/100 × {Math.round(n[f] * 100)}%
                </span>
              </span>
              <span className="tabular font-mono text-sm text-ink">+{pts.toFixed(1)}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-paper-deep">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full opacity-25"
                style={{ background: FACTOR_COLOR[f] }}
                initial={{ width: 0 }}
                animate={{ width: `${score[f] * 100}%` }}
                transition={spring}
              />
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: FACTOR_COLOR[f] }}
                initial={{ width: 0 }}
                animate={{ width: `${score[f] * n[f] * 100}%` }}
                transition={spring}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FactorLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {FACTORS.map((f) => (
        <span key={f} className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: FACTOR_COLOR[f] }} />
          {FACTOR_LABEL[f]}
        </span>
      ))}
    </div>
  );
}
