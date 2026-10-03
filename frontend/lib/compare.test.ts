import { describe, expect, it } from "vitest";
import { scoreGap } from "./compare";
import { flipText } from "./flip-text";

describe("comparisons", () => {
  it("a gap under 0.5 pts is practically a tie, not '0,0 pkt'", () => {
    expect(scoreGap(0.04)).toBe("tie");
    expect(scoreGap(-0.49)).toBe("tie");
    expect(scoreGap(0.5)).toBe("higher");
    expect(scoreGap(-3.6)).toBe("lower");
  });
});

describe("flip text (mirrors the backend's plain language)", () => {
  it("names the trigger and the winner; never 'pkt'", () => {
    const pl = flipText("pl", "Lizbona", { factor: "weather", from: 0.2, to: 0.31 }, "Rzym");
    expect(pl).toBe("Jeśli pogoda będzie dla Ciebie ważniejsza (waga z 0,20 na 0,31), lepszą opcją będzie Lizbona.");
    expect(flipText("pl", "Ateny", { factor: "price", from: 0.4, to: 0.5 }, "Rzym")).toMatch(/lepszą opcją będą Ateny\.$/);
    expect(flipText("en", "Lisbon", { factor: "crowds", from: 0.15, to: 0.3 }, "Rome")).toBe(
      "If avoiding crowds matters more to you (weight from 0.15 to 0.30), Lisbon wins.",
    );
    expect(flipText("pl", "Porto", null, "Rzym")).toMatch(/^Żadna pojedyncza zmiana/);
    expect(pl).not.toMatch(/pkt/);
  });
});
