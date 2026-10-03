import { describe, expect, it } from "vitest";
import { handoffLinks, originOf } from "./handoff";
import { scoreLocally } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { weightsFromSlider } from "./scoring";
import { sameWeights } from "./use-recommendations";

const rec = scoreLocally(DEMO_PROFILE, weightsFromSlider(50))[0];
const fromWaw = {
  ...rec,
  evidence: rec.evidence.map((e) => (e.kind === "flight" ? { ...e, label: "Return WAW-MLA 01.01-03.01" } : e)),
};

describe("hand-off uses the priced origin", () => {
  it("reads the origin from flight evidence", () => {
    expect(originOf(rec)).toBe("KRK");
    expect(originOf(fromWaw)).toBe("WAW");
  });
  it("falls back to the profile airport when evidence has none", () => {
    expect(originOf({ ...rec, evidence: [] }, "KTW")).toBe("KTW");
  });
  it("puts the origin into the Google Flights link", () => {
    expect(decodeURIComponent(handoffLinks(fromWaw)[0].url)).toContain("Flights from WAW to");
  });
});

describe("receipt freshness", () => {
  it("compares weights after normalisation", () => {
    expect(sameWeights({ price: 2, weather: 1, crowds: 1, taste: 0 }, { price: 0.5, weather: 0.25, crowds: 0.25, taste: 0 })).toBe(true);
    expect(sameWeights(weightsFromSlider(0), weightsFromSlider(50))).toBe(false);
    expect(sameWeights(null, weightsFromSlider(50))).toBe(false);
  });
  it("fixture flip hints always point at the current neighbour", () => {
    for (const pos of [0, 50, 100]) {
      const ranked = scoreLocally(DEMO_PROFILE, weightsFromSlider(pos));
      expect(ranked[0].flip?.rival_id).toBe(ranked[1].id);
      ranked.slice(1).forEach((r, i) => expect(r.flip?.rival_id).toBe(ranked[i].id));
    }
  });
});
