/**
 * Glanceable star ratings, derived deterministically from the scorer's 0–1 numbers.
 * The stars are a display rounding only; the exact math (factor score × weight, sources,
 * inputs hash) stays on the receipt under "How we scored it".
 *
 * Overall score  → half stars 0–5:   stars = round(total × 10) / 2
 *                  exact number:     (total × 5) with one decimal   (0.882 → ★★★★½ 4.4)
 * Factor score   → whole stars 1–5:  stars = clamp(round(score × 5), 1, 5)
 *                  (0.84 → 4, 0.86 → 4, 0.90 → 5, 0.05 → 1; a factor is never shown as 0 stars)
 */
export const MAX_STARS = 5;

export function overallStars(total: number): number {
  const t = Math.min(1, Math.max(0, total));
  return Math.round(t * 10) / 2;
}

/** The precise overall on the 5-point scale, for the small number next to the stars. */
export function overallOutOfFive(total: number): number {
  return Math.round(Math.min(1, Math.max(0, total)) * 50) / 10;
}

export function factorStars(score: number): number {
  const s = Math.min(1, Math.max(0, score));
  return Math.min(MAX_STARS, Math.max(1, Math.round(s * MAX_STARS)));
}
