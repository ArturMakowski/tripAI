/** Budget presentation: over-budget amounts and the "top pick is over budget" explanation. */
import type { RankedRecommendation } from "./types";

/**
 * PLN over the user's budget (> 0), 0 if within, null if there is no budget.
 * Prefers the backend's mark (`over_budget_pln`); otherwise plain arithmetic on backend numbers.
 */
export function overBudget(rec: Pick<RankedRecommendation, "total_cost_pln" | "over_budget_pln">, budget: number | null): number | null {
  if (typeof rec.over_budget_pln === "number") return Math.max(0, Math.round(rec.over_budget_pln));
  if (budget == null) return null;
  return Math.max(0, Math.round(rec.total_cost_pln - budget));
}

export type BudgetBanner =
  | { kind: "none_fit"; budget: number; cheapest: RankedRecommendation; over: number }
  | { kind: "top_over"; budget: number; top: RankedRecommendation; over: number; withinCount: number };

/**
 * Never show an over-budget trip as #1 without saying so. `list` is in display order.
 * - nothing fits: "Nothing fits {budget} for these dates — closest options"
 * - some fit but #1 doesn't: say by how much, and how many do fit
 */
export function budgetBanner(
  list: RankedRecommendation[],
  budget: number | null,
  /** every trip, including collapsed ones, so "cheapest" and "how many fit" are never understated */
  pool: RankedRecommendation[] = list,
): BudgetBanner | null {
  if (budget == null || !list.length) return null;
  const top = list[0];
  const topOver = overBudget(top, budget) ?? 0;
  if (topOver <= 0) return null;
  const within = pool.filter((r) => (overBudget(r, budget) ?? 0) <= 0);
  if (!within.length) {
    const cheapest = pool.reduce((a, b) => (b.total_cost_pln < a.total_cost_pln ? b : a));
    return { kind: "none_fit", budget, cheapest, over: overBudget(cheapest, budget) ?? 0 };
  }
  return { kind: "top_over", budget, top, over: topOver, withinCount: within.length };
}

/** Stable partition: trips within budget first, each group keeps its ranking order. */
export function withinBudgetFirst<T extends RankedRecommendation>(list: T[], budget: number | null): T[] {
  if (budget == null) return list;
  const fits = (r: T) => (overBudget(r, budget) ?? 0) <= 0;
  return [...list.filter(fits), ...list.filter((r) => !fits(r))];
}
