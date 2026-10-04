import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
    configurable: true,
  });
});
import { renderToStaticMarkup } from "react-dom/server";
import { RecCard } from "@/components/rec-card";
import { disagreement } from "@/lib/fit";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { scoreLocally } from "@/lib/mock/api";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";

describe("cards never carry the score/fit disagreement note (it lives on the trip page)", () => {
  it("a high score with a poor fit renders no note on the card", () => {
    const [rec] = scoreLocally(DEMO_PROFILE, DEFAULT_WEIGHTS);
    const split = {
      ...rec,
      score: { ...rec.score, total: 0.9 },
      fit: { label: "poor_fit", summary: "Not your style", confidence: 0.9, matches: [], concerns: [], model: "rules", created_at: null },
    } as unknown as typeof rec;
    expect(disagreement(split)).toBe("high_score_poor_fit");
    const html = renderToStaticMarkup(<RecCard rec={split} />);
    expect(html).not.toMatch(/Score and fit disagree|Wynik i dopasowanie się różnią/);
    expect(html).toContain("Not your style"); // the fit line itself stays
  });
});
