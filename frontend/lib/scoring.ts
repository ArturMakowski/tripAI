/**
 * Client-side mirror of the deterministic re-weighting done by `tripai.scoring`.
 * The backend owns the factor scores; the UI only recombines them with the
 * slider weights so ranking reacts instantly, then the backend confirms.
 */
import type { Recommendation, ScoreBreakdown, Weights } from "./types";

export const FACTORS = ["price", "weather", "crowds", "taste"] as const;
export type Factor = (typeof FACTORS)[number];

export const FACTOR_LABEL: Record<Factor, string> = {
  price: "Price",
  weather: "Weather",
  crowds: "Crowds",
  taste: "Taste fit",
};

export const DEFAULT_WEIGHTS: Weights = { price: 0.4, weather: 0.2, crowds: 0.15, taste: 0.25 };

export function normalise(w: Weights): Weights {
  const sum = FACTORS.reduce((s, f) => s + Math.max(0, w[f]), 0) || 1;
  return {
    price: Math.max(0, w.price) / sum,
    weather: Math.max(0, w.weather) / sum,
    crowds: Math.max(0, w.crowds) / sum,
    taste: Math.max(0, w.taste) / sum,
  };
}

export function weightedTotal(s: Omit<ScoreBreakdown, "total">, w: Weights): number {
  const n = normalise(w);
  return FACTORS.reduce((t, f) => t + n[f] * s[f], 0);
}

/** Re-score and sort, highest total first (same tie-break as the backend); sets `rank`. Pure. */
export function rerank<T extends Recommendation & { rank?: number }>(recs: T[], w: Weights): T[] {
  return recs
    .map((r) => ({ ...r, score: { ...r.score, total: weightedTotal(r.score, w) } }))
    .sort((a, b) => b.score.total - a.score.total || a.total_cost_pln - b.total_cost_pln)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// --- Slider: price <-> comfort <-> experience -------------------------------

/** Anchor presets for the single slider (0 = price, 50 = comfort, 100 = experience). */
export const SLIDER_PRESETS: { at: number; key: "price" | "comfort" | "experience"; label: string; weights: Weights }[] = [
  { at: 0, key: "price", label: "Price", weights: { price: 0.6, weather: 0.15, crowds: 0.1, taste: 0.15 } },
  { at: 50, key: "comfort", label: "Comfort", weights: { price: 0.25, weather: 0.3, crowds: 0.25, taste: 0.2 } },
  { at: 100, key: "experience", label: "Experience", weights: { price: 0.12, weather: 0.13, crowds: 0.15, taste: 0.6 } },
];

export function weightsFromSlider(pos: number): Weights {
  const p = Math.min(100, Math.max(0, pos));
  const [a, b] = p <= 50 ? [SLIDER_PRESETS[0], SLIDER_PRESETS[1]] : [SLIDER_PRESETS[1], SLIDER_PRESETS[2]];
  const t = (p - a.at) / (b.at - a.at);
  const lerp = (f: Factor) => a.weights[f] + (b.weights[f] - a.weights[f]) * t;
  return normalise({ price: lerp("price"), weather: lerp("weather"), crowds: lerp("crowds"), taste: lerp("taste") });
}

// --- "What would flip it" ----------------------------------------------------

export interface Flip {
  factor: Factor;
  /** Change in normalised weight (percentage points) at which `challenger` overtakes. */
  deltaPts: number;
  challenger: string;
}

/**
 * For each factor, the smallest single-weight change (others fixed) that makes
 * `challenger` beat `leader`. Exact algebra on the weighted sum, no LLM.
 */
export function flipConditions(leader: Recommendation, challenger: Recommendation, w: Weights): Flip[] {
  const n = normalise(w);
  const d = (f: Factor) => leader.score[f] - challenger.score[f];
  const margin = FACTORS.reduce((s, f) => s + n[f] * d(f), 0); // > 0 while leader wins
  if (margin <= 0) return [];
  const out: Flip[] = [];
  for (const f of FACTORS) {
    const df = d(f);
    if (Math.abs(df) < 1e-6) continue;
    const x = -margin / df; // raw weight change on factor f (sum of weights = 1 before change)
    if (n[f] + x <= 0.02) continue; // would need to (nearly) drop the factor entirely
    // express as change in the factor's normalised share after renormalising
    const share = (n[f] + x) / (1 + x) - n[f];
    if (!Number.isFinite(share) || Math.abs(share) > 0.6) continue;
    out.push({ factor: f, deltaPts: Math.round(share * 1000) / 10, challenger: challenger.city });
  }
  return out.sort((a, b) => Math.abs(a.deltaPts) - Math.abs(b.deltaPts));
}

// --- Inputs hash ---------------------------------------------------------------

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over the canonical JSON of everything the score depends on. */
export async function inputsHash(rec: Recommendation, w: Weights): Promise<string> {
  const payload = canonical({
    city: rec.iata,
    window: { start: rec.window.start, end: rec.window.end },
    weights: normalise(w),
    evidence: rec.evidence.map((e) => ({ kind: e.kind, value: e.value, source: e.source, fetched_at: e.fetched_at })),
  });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
