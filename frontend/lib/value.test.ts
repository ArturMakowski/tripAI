import { describe, expect, it } from "vitest";
import { scoreLocally } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { weightsFromSlider } from "./scoring";
import type { RankedRecommendation } from "./types";
import { withValueBadges } from "./value";

const base = scoreLocally(DEMO_PROFILE, weightsFromSlider(50));
const byCity = (xs: RankedRecommendation[], c: string) => xs.find((r) => r.city === c)!;

describe("value badges (docs/BUDGET.md)", () => {
  it("worth_splurge needs ≥15% pricier than the cheapest top-5 alternative AND clearly better non-price scores", () => {
    const athens = byCity(base, "Athens"); // the cheapest
    const lux = { ...byCity(base, "Rome"), total_cost_pln: athens.total_cost_pln * 1.3, score: { ...byCity(base, "Rome").score, weather: 0.95, crowds: 0.95, taste: 0.95 } };
    const out = withValueBadges([lux, ...base.filter((r) => r.city !== "Rome")], "en");
    expect(out[0].value_badge).toBe("worth_splurge");
    expect(out[0].value_reason).toMatch(/^\+\d[\d,]* PLN than Athens/);
    const pl = withValueBadges([lux, ...base.filter((r) => r.city !== "Rome")], "pl");
    expect(pl[0].value_reason).toMatch(/zł niż Ateny|zł niż Athens/);
  });

  it("not a splurge when it is pricier but not better", () => {
    const athens = byCity(base, "Athens");
    const meh = { ...byCity(base, "Venice"), total_cost_pln: athens.total_cost_pln * 1.5, score: { ...athens.score, price: 0.3 } };
    expect(withValueBadges([meh, athens], "en")[0].value_badge).not.toBe("worth_splurge");
  });

  it("great_value: price ≥ 0.8 with a good fit, reason quotes the evidence", () => {
    const athens = { ...byCity(base, "Athens"), fit: { ...(byCity(base, "Athens").fit ?? {}), label: "good_fit" } } as RankedRecommendation;
    const [v] = withValueBadges([athens], "en");
    expect(v.value_badge).toBe("great_value");
    expect(v.value_reason).toMatch(/Flight 384 PLN, below the typical 420–690 PLN/);
  });

  it("never overrides a backend badge, and is deterministic", () => {
    const set = base.map((r, i) => (i === 0 ? { ...r, value_badge: "great_value", value_reason: "from backend" } : r));
    expect(withValueBadges(set, "en")[0].value_reason).toBe("from backend");
    expect(withValueBadges(base, "pl")).toEqual(withValueBadges(base, "pl"));
  });
});
