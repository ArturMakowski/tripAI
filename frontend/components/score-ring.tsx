"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

/** Circular score (0..1) with an animated stroke and count-up number. */
export function ScoreRing({
  value,
  size = 56,
  stroke = 5,
  className,
  tone = "pine",
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  tone?: "pine" | "light";
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mv = useMotionValue(0);
  const dash = useTransform(mv, (v) => `${(v / 100) * c} ${c}`);
  const text = useTransform(mv, (v) => Math.round(v).toString());

  useEffect(() => {
    const ctrl = animate(mv, value * 100, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => ctrl.stop();
  }, [mv, value]);

  const light = tone === "light";
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? "Score"} ${Math.round(value * 100)} of 100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill={light ? "oklch(0.2 0.02 165 / 0.35)" : "var(--card)"}
          stroke={light ? "oklch(1 0 0 / 0.25)" : "var(--line)"}
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={light ? "oklch(0.98 0.01 85)" : "var(--pine)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ strokeDasharray: dash }}
        />
      </svg>
      <motion.span
        className={cn(
          "tabular absolute font-display font-semibold leading-none",
          light ? "text-white" : "text-ink",
        )}
        style={{ fontSize: size * 0.34 }}
      >
        {text}
      </motion.span>
    </div>
  );
}
