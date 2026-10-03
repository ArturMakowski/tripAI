import { describe, expect, it } from "vitest";
import { applyFeedback, interview, scoreLocally } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { flipConditions, inputsHash, normalise, rerank, weightedTotal, weightsFromSlider } from "./scoring";

const sum = (w: object) => Object.values(w as Record<string, number>).reduce((a, b) => a + b, 0);

describe("scoring", () => {
  it("normalises weights to 1", () => {
    expect(sum(normalise({ price: 2, weather: 1, crowds: 1, taste: 0 }))).toBeCloseTo(1);
    for (const p of [0, 25, 50, 80, 100]) expect(sum(weightsFromSlider(p))).toBeCloseTo(1);
  });

  it("slider re-ranks: price end favours Athens, experience end favours Rome", () => {
    expect(scoreLocally(DEMO_PROFILE, weightsFromSlider(0))[0].city).toBe("Athens");
    expect(scoreLocally(DEMO_PROFILE, weightsFromSlider(100))[0].city).toBe("Rome");
  });

  it("rerank sorts by weighted total", () => {
    const ranked = rerank(scoreLocally(DEMO_PROFILE, weightsFromSlider(50)), weightsFromSlider(50));
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score.total).toBeGreaterThanOrEqual(ranked[i].score.total);
  });

  it("flip conditions actually flip the ranking", () => {
    const w = weightsFromSlider(50);
    const [a, b] = scoreLocally(DEMO_PROFILE, w);
    const flips = flipConditions(a, b, w);
    expect(flips.length).toBeGreaterThan(0);
    const f = flips[0];
    const n = normalise(w);
    const target = n[f.factor] + f.deltaPts / 100 + Math.sign(f.deltaPts) * 0.01;
    // set the factor's share to target, rescale the others proportionally
    const rest = 1 - n[f.factor];
    const w2 = { ...n };
    for (const k of Object.keys(w2) as (keyof typeof w2)[]) w2[k] = k === f.factor ? target : (n[k] / rest) * (1 - target);
    expect(weightedTotal(b.score, w2)).toBeGreaterThan(weightedTotal(a.score, w2));
  });

  it("inputs hash is deterministic and weight-sensitive", async () => {
    const [r] = scoreLocally(DEMO_PROFILE, weightsFromSlider(50));
    const h1 = await inputsHash(r, weightsFromSlider(50));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await inputsHash(r, weightsFromSlider(50))).toBe(h1);
    expect(await inputsHash(r, weightsFromSlider(0))).not.toBe(h1);
  });
});

describe("mock backend", () => {
  it("emits RankedRecommendation shape with receipts", () => {
    const recs = scoreLocally(DEMO_PROFILE, weightsFromSlider(50));
    expect(recs.map((r) => r.rank)).toEqual(recs.map((_, i) => i + 1));
    expect(recs[0].id).toMatch(/^[A-Z]{3}-\d{8}-\d{8}$/);
    expect(recs[0].counterfactuals.map((c) => c.kind)).toEqual(["peak_season", "next_window", "runner_up"]);
    expect(recs[0].flip?.rival_id).toBe(recs[1].id);
    expect(recs[2].flip?.rival_id).toBe(recs[1].id);
  });

  it("every evidence item carries source + fetched_at", () => {
    for (const r of scoreLocally(DEMO_PROFILE, weightsFromSlider(50)))
      for (const e of r.evidence) {
        expect(e.source).toBeTruthy();
        expect(Number.isNaN(Date.parse(e.fetched_at))).toBe(false);
      }
  });

  it("survey with bad crowds raises crowd weight and moves Rome to #1 from the price end", () => {
    const w = weightsFromSlider(0);
    const fb = applyFeedback(DEMO_PROFILE, w, {
      trip_id: "BCN-20260812-20260817",
      answers: { crowds: 1, weather: 2, price: 4, taste: 5, loved: ["food"] },
    });
    expect(fb.weights.crowds).toBeGreaterThan(normalise(w).crowds);
    expect(fb.profile.interests.food).toBeGreaterThan(DEMO_PROFILE.interests.food);
    expect(fb.diff.some((c) => c.field === "weights.crowds")).toBe(true);
    expect(fb.dislikes).toContain("crowds"); // top-level profile fields, like the backend
    expect(scoreLocally(fb.profile, fb.weights)[0].city).toBe("Rome");
  });

  it("interview returns a profile after four answers", async () => {
    const msgs = ["Food & history", "Crowds and heat", "About 1,800 PLN", "KTW, comfortable"].flatMap((c) => [
      { role: "assistant" as const, content: "?" },
      { role: "user" as const, content: c },
    ]);
    const res = await interview(msgs);
    expect(res.profile?.origin_airports).toEqual(["KTW"]);
    expect(res.profile?.budget_pln).toBe(1800);
    expect(res.profile?.dislikes).toContain("crowds");
    expect(res.profile?.luxury).toBe("comfort");
  });
});
