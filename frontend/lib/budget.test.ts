import { describe, expect, it } from "vitest";
import { budgetBanner, overBudget, withinBudgetFirst } from "./budget";
import { markBudget, scoreLocally } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { weightsFromSlider } from "./scoring";

const recs = scoreLocally(DEMO_PROFILE, weightsFromSlider(50)); // Rome 1442 is #1; totals 1104..1718

describe("budget", () => {
  it("prefers the backend's over_budget_pln, else plain arithmetic, null without a budget", () => {
    expect(overBudget({ total_cost_pln: 2629, over_budget_pln: 1629 }, 1000)).toBe(1629);
    expect(overBudget({ total_cost_pln: 1442 }, 1000)).toBe(442);
    expect(overBudget({ total_cost_pln: 900 }, 1000)).toBe(0);
    expect(overBudget({ total_cost_pln: 900 }, null)).toBeNull();
  });

  it("no banner when #1 fits", () => {
    expect(budgetBanner(recs, 1800)).toBeNull();
    expect(budgetBanner(recs, null)).toBeNull();
  });

  it("'nothing fits' names the cheapest option and how far over it is", () => {
    const b = budgetBanner(markBudget(recs, 1000), 1000);
    expect(b?.kind).toBe("none_fit");
    if (b?.kind !== "none_fit") return;
    expect(b.cheapest.city).toBe("Athens");
    expect(b.over).toBe(104);
  });

  it("cheapest comes from every trip, including ones collapsed as 'not your style'", () => {
    const all = markBudget(recs, 1000);
    const visible = all.filter((r) => r.city !== "Athens");
    const b = budgetBanner(visible, 1000, all);
    expect(b?.kind === "none_fit" && b.cheapest.city).toBe("Athens");
  });

  it("#1 over budget while others fit: explains and offers within-budget first", () => {
    const b = budgetBanner(recs, 1400); // Rome 1442 over by 42; Athens 1104, Porto 1302 fit
    expect(b).toMatchObject({ kind: "top_over", over: 42, withinCount: 2 });
    const reordered = withinBudgetFirst(recs, 1400);
    expect(reordered[0].total_cost_pln).toBeLessThanOrEqual(1400);
    expect(budgetBanner(reordered, 1400)).toBeNull();
    // stable: within-budget trips keep their ranking order
    const within = recs.filter((r) => r.total_cost_pln <= 1400).map((r) => r.id);
    expect(reordered.slice(0, within.length).map((r) => r.id)).toEqual(within);
  });
});
