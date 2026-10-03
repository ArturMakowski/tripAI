"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** App-wide: every motion animation (card re-orders, price slides, fades) honours prefers-reduced-motion. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
