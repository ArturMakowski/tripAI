"use client";

import { useId } from "react";
import { useT } from "@/lib/i18n";
import { FACTORS, type Factor } from "@/lib/scoring";
import { factorStars, MAX_STARS, overallOutOfFive, overallStars } from "@/lib/stars";
import type { ScoreBreakdown } from "@/lib/types";
import { cn } from "@/lib/utils";

export const FACTOR_EMOJI: Record<Factor, string> = { price: "💰", weather: "☀️", crowds: "👥", taste: "❤️" };

const STAR = "M12 2.6l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.9 6.2 20.1l1.4-6.4L2.7 9.3l6.5-.7z";

/** Five stars, filled to `value` (0–5, half steps). Decorative: the parent carries the aria-label. */
export function StarRow({ value, size = 14, tone = "default" }: { value: number; size?: number; tone?: "default" | "light" }) {
  const id = useId();
  const on = tone === "light" ? "oklch(0.86 0.13 85)" : "var(--sun)";
  const off = tone === "light" ? "oklch(1 0 0 / 0.35)" : "var(--line)";
  return (
    <span className="inline-flex shrink-0 items-center gap-px" aria-hidden>
      {Array.from({ length: MAX_STARS }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i)); // 0, 0.5 or 1
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24">
            {fill > 0 && fill < 1 && (
              <defs>
                <linearGradient id={`${id}-${i}`}>
                  <stop offset="50%" stopColor={on} />
                  <stop offset="50%" stopColor={off} />
                </linearGradient>
              </defs>
            )}
            <path d={STAR} fill={fill >= 1 ? on : fill > 0 ? `url(#${id}-${i})` : off} />
          </svg>
        );
      })}
    </span>
  );
}

/** "★★★★½ 4.4": overall score at a glance, exact number in small text. */
export function OverallStars({
  total,
  size = 16,
  tone = "default",
  className,
}: {
  total: number;
  size?: number;
  tone?: "default" | "light";
  className?: string;
}) {
  const { t, fmt } = useT();
  const stars = overallStars(total);
  const exact = overallOutOfFive(total);
  return (
    <span role="img" aria-label={t.stars.overallAria(stars, exact)} className={cn("inline-flex items-center gap-1.5", className)}>
      <StarRow value={stars} size={size} tone={tone} />
      <span className={cn("tabular text-xs font-semibold", tone === "light" ? "text-white/90" : "text-ink-soft")}>{fmt.num(exact, 1)}</span>
    </span>
  );
}

/** Icon + label + 1–5 stars per factor; scannable in a second. */
export function FactorStars({ score, columns = 1, className }: { score: ScoreBreakdown; columns?: 1 | 2; className?: string }) {
  const { t } = useT();
  return (
    <ul className={cn("grid gap-x-3 gap-y-1.5", columns === 2 ? "grid-cols-2" : "grid-cols-1", className)}>
      {FACTORS.map((f) => {
        const n = factorStars(score[f]);
        const label = columns === 2 ? t.trips.factorsShort[f] : t.trips.factors[f];
        return (
          <li key={f} role="img" aria-label={t.stars.factorAria(t.trips.factors[f], n)} className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span aria-hidden className="w-5 shrink-0 text-center leading-none">
              {FACTOR_EMOJI[f]}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-soft" aria-hidden>
              {label}
            </span>
            <StarRow value={n} size={columns === 2 ? 11 : 14} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One glanceable line for the receipt: overall stars, then each factor's icon with its stars.
 * No numbers and no explanation on screen; the exact math is in the collapsed Audit.
 */
export function CompactStars({ score, className }: { score: ScoreBreakdown; className?: string }) {
  const { t } = useT();
  const stars = overallStars(score.total);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <span role="img" aria-label={t.stars.overallAria(stars, overallOutOfFive(score.total))}>
        <StarRow value={stars} size={20} />
      </span>
      {FACTORS.map((f) => {
        const n = factorStars(score[f]);
        return (
          <span key={f} role="img" aria-label={t.stars.factorAria(t.trips.factors[f], n)} className="inline-flex items-center gap-1">
            <span aria-hidden className="text-sm leading-none">
              {FACTOR_EMOJI[f]}
            </span>
            <StarRow value={n} size={11} />
          </span>
        );
      })}
    </div>
  );
}
