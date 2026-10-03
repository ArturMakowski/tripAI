import { describe, expect, it } from "vitest";
import { disagreement, dnaQuotes, modelLabel } from "./fit";
import { scoreLocally } from "./mock/api";
import { CLIENT_PREVIEW_MODEL, labelFromScore, rulesFit, withFit } from "./mock/fit";
import { DEMO_PROFILE } from "./mock/fixtures";
import { weightsFromSlider } from "./scoring";
import type { TasteProfile } from "./types";

const recs = scoreLocally(DEMO_PROFILE, weightsFromSlider(50));
const DNA_IDS = new Set([...Array.from({ length: 12 }, (_, i) => `q${i + 1}`), "y1", "y2"]);

describe("rules fit (docs/FIT_VERDICT.md fallback)", () => {
  it("every match/concern cites an existing DNA card and/or evidence index", () => {
    for (const r of withFit(recs, DEMO_PROFILE, "rules")) {
      for (const p of [...r.fit!.matches, ...r.fit!.concerns]) {
        expect(p.dna.length + p.evidence.length).toBeGreaterThan(0);
        p.dna.forEach((d) => expect(DNA_IDS.has(d)).toBe(true));
        p.evidence.forEach((i) => expect(r.evidence[i]).toBeTruthy());
      }
    }
  });

  it("uses only numbers that appear in the cited evidence", () => {
    for (const r of withFit(recs, DEMO_PROFILE, "rules"))
      for (const p of [...r.fit!.matches, ...r.fit!.concerns]) {
        const nums = p.text.match(/\d+(\.\d+)?/g) ?? [];
        const cited = p.evidence.map((i) => String(r.evidence[i].value)).join(" ");
        nums.forEach((n) => expect(cited).toContain(n));
      }
  });

  it("labels from score bands", () => {
    expect([0.85, 0.75, 0.65, 0.5].map(labelFromScore)).toEqual(["great_fit", "good_fit", "mixed", "poor_fit"]);
  });

  it("food match needs food in the cited sights: Porto (no food sight) gets none, Rome does", () => {
    const fits = withFit(recs, DEMO_PROFILE, "rules");
    const food = (city: string) => fits.find((r) => r.city === city)!.fit!.matches.some((m) => m.dna.includes("q5"));
    expect(food("Porto")).toBe(false);
    expect(food("Rome")).toBe(true);
  });

  it("verdict follows the current weights (no stale labels after the slider moves)", () => {
    const at = (pos: number) => {
      const r = scoreLocally(DEMO_PROFILE, weightsFromSlider(pos));
      return withFit(r, DEMO_PROFILE, "rules").find((x) => x.city === "Venice")!.fit!.label;
    };
    expect(at(50)).toBe("poor_fit");
    expect(at(100)).not.toBe("poor_fit");
  });

  it("never cites or quotes cards the user didn't answer", () => {
    const p: TasteProfile = { ...DEMO_PROFILE, traits: undefined, dislikes: ["crowds"] };
    const athens = recs.find((r) => r.city === "Athens")!;
    const fit = rulesFit(athens, p);
    expect(fit.concerns[0].text).toMatch(/listed crowds as a dislike/);
    expect(fit.concerns[0].dna).toEqual([]);
    expect(fit.concerns[0].evidence.length).toBe(1);
    expect(dnaQuotes(["q11"], p, "en")).toEqual([]);
  });

  it("a crowd-avoider gets a crowd concern that caps the label, and the disagreement is flagged", () => {
    const crowdy = { ...recs[0], score: { ...recs[0].score, total: 0.86 } };
    crowdy.evidence = crowdy.evidence.map((e) => (e.kind === "crowds" ? { ...e, value: 0.7 } : e));
    const fit = rulesFit(crowdy, DEMO_PROFILE);
    expect(fit.concerns[0].dna).toEqual(["q8", "q11"]);
    expect(["mixed", "poor_fit"]).toContain(fit.label);
    expect(disagreement({ ...crowdy, fit })).toBe("high_score_poor_fit");
    expect(fit.summary).toMatch(/^Scores well, but/);
  });

  it("personalize = No: neutral DNA, dislikes ignored, no personal quotes", () => {
    const p: TasteProfile = { ...DEMO_PROFILE, personalize: false, dislikes: ["crowds"] };
    for (const r of recs) {
      const fit = rulesFit(r, p);
      expect([...fit.matches, ...fit.concerns].every((x) => x.dna.length === 0)).toBe(true);
      expect(fit.concerns.some((c) => /crowd/i.test(c.text))).toBe(false);
      expect(fit.summary).toContain("neutral DNA");
    }
    expect(dnaQuotes(["q11"], p, "pl")).toEqual([]);
  });

  it("never overrides a backend verdict", () => {
    const backend = { ...recs[0], fit: { ...rulesFit(recs[0], DEMO_PROFILE), model: "openai:x", label: "great_fit" } };
    expect(withFit([backend], DEMO_PROFILE, "rules")[0].fit!.model).toBe("openai:x");
  });
});

describe("presentation", () => {
  it("rule texts, labels and model names come back in Polish when asked", () => {
    const athens = recs.find((r) => r.city === "Athens")!;
    const fit = rulesFit(athens, DEMO_PROFILE, "rules", "pl");
    expect(fit.concerns[0].text).toMatch(/^Umiarkowany tłum, a/);
    expect(modelLabel(fit, "pl")).toBe("Sprawdzenie regułami");
  });

  it("labels rule-based verdicts plainly", () => {
    const f = rulesFit(recs[0], DEMO_PROFILE);
    expect(modelLabel(f)).toBe("Rule-based check");
    expect(modelLabel({ ...f, model: CLIENT_PREVIEW_MODEL })).toMatch(/preview computed on this device/);
    expect(modelLabel({ ...f, model: "anthropic:claude" })).toBe("AI check · anthropic:claude");
  });
  it("quotes the DNA card and the swiped answer", () => {
    expect(dnaQuotes(["q11"], DEMO_PROFILE, "pl")).toEqual(["przesunięto „Bardzo ja!” przy: Lubię podróżować z dala od tłumów."]);
    expect(dnaQuotes(["q8"], DEMO_PROFILE, "en")).toEqual(["you swiped “That's me” on: I often pick less touristy places."]);
  });
});
