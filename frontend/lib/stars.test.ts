import { describe, expect, it } from "vitest";
import { factorStars, overallOutOfFive, overallStars } from "./stars";

describe("star mapping (documented in lib/stars.ts)", () => {
  it("overall: half stars = round(total × 10) / 2", () => {
    expect([0, 0.04, 0.05, 0.5, 0.82, 0.84, 0.85, 0.882, 0.95, 1].map(overallStars)).toEqual([0, 0, 0.5, 2.5, 4, 4, 4.5, 4.5, 5, 5]);
  });
  it("overall exact number is total × 5 with one decimal", () => {
    expect(overallOutOfFive(0.882)).toBe(4.4);
    expect(overallOutOfFive(0.823)).toBe(4.1);
    expect(overallOutOfFive(1)).toBe(5);
  });
  it("factors: whole stars 1–5 = clamp(round(score × 5), 1, 5)", () => {
    expect([0, 0.05, 0.3, 0.5, 0.74, 0.84, 0.86, 0.9, 1].map(factorStars)).toEqual([1, 1, 2, 3, 4, 4, 4, 5, 5]);
  });
  it("is monotonic and clamps out-of-range input", () => {
    let prev = -1;
    for (let s = 0; s <= 1.0001; s += 0.01) {
      expect(overallStars(s)).toBeGreaterThanOrEqual(prev);
      prev = overallStars(s);
    }
    expect(overallStars(1.4)).toBe(5);
    expect(factorStars(-0.2)).toBe(1);
  });
  it("the demo example: 0.882 → ★★★★½ 4.4", () => {
    expect([overallStars(0.882), overallOutOfFive(0.882)]).toEqual([4.5, 4.4]);
  });
});
