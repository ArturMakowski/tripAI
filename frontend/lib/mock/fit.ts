/**
 * Stand-in for the backend fit agent's deterministic fallback (docs/FIT_VERDICT.md,
 * model = "rules"): label from score bands, matches/concerns from hard DNA rules.
 * Every point cites DNA card ids and/or evidence indexes that exist, and uses only
 * numbers that appear in the cited evidence.
 */
import type { FitPoint, FitVerdict, Recommendation, TasteProfile } from "../types";

export const CLIENT_PREVIEW_MODEL = "rules:client-preview";

const LABELS = ["poor_fit", "mixed", "good_fit", "great_fit"] as const;
type Label = (typeof LABELS)[number];

/** Score band -> label (same bands as the backend rules fallback). */
export function labelFromScore(total: number): Label {
  return total >= 0.8 ? "great_fit" : total >= 0.72 ? "good_fit" : total >= 0.62 ? "mixed" : "poor_fit";
}

const FOOD = /food|market|tavern|trattoria|cuisine|cicchetti|tapas|pastr|street food|francesinha|wine/i;
const ACTIVE = /hik|trail|surf|cycl|kayak|climb|ridge/i;

const num = (v: number | string | undefined) => (typeof v === "number" ? v : Number.NaN);

export function rulesFit(rec: Recommendation, profile: TasteProfile, model = "rules"): FitVerdict {
  const t = profile.traits ?? {};
  // Personalize = No: verdict is computed against neutral DNA (all answers 3).
  const neutral = profile.personalize === false;
  const a = (q: string) => (neutral ? 3 : (t[q] ?? 3));
  const high = (...qs: string[]) => qs.filter((q) => !neutral && typeof t[q] === "number" && a(q) >= 4);
  const idx = (kind: string) => rec.evidence.findIndex((e) => e.kind === kind);
  const ev = (kind: string) => rec.evidence[idx(kind)];
  // Real tag names only (RankedRecommendation.tags); free-text signals come from the cited evidence.
  const tags = new Set("tags" in rec && Array.isArray(rec.tags) ? (rec.tags as string[]) : []);
  const sights = String(ev("attraction")?.value ?? "");

  const matches: FitPoint[] = [];
  const concerns: (FitPoint & { severity: number })[] = [];
  const cite = (kinds: string[]) => kinds.map(idx).filter((i) => i >= 0);

  const crowd = num(ev("crowds")?.value);
  const temp = num(ev("weather")?.value);
  const [lo, hi] = profile.preferred_temp_c;
  // Only cards the user actually answered may be cited (never an assumed default).
  const answered = (q: string) => !neutral && typeof t[q] === "number";
  const crowdHaters = ["q8", "q11"].filter((q) => answered(q) && a(q) >= 4);
  const dislikesCrowds = !neutral && profile.dislikes.includes("crowds");

  // --- matches -----------------------------------------------------------------------
  if (high("q5").length && FOOD.test(sights))
    matches.push({ text: "Food among the top sights, and you said you love local food", dna: ["q5"], evidence: cite(["attraction"]) });
  if (Number.isFinite(temp) && temp >= lo && temp <= hi)
    matches.push({ text: `Around ${temp} °C, inside your comfortable range`, dna: [], evidence: cite(["weather"]) });
  if (Number.isFinite(crowd) && crowd <= 0.35 && crowdHaters.length)
    matches.push({ text: "Off-season: crowds are low, as you prefer", dna: crowdHaters, evidence: cite(["crowds"]) });
  const base = ev("price_baseline");
  if (base) {
    // Compare like with like: a fare range vs the flight, a trip-total median vs the total.
    const low = typeof base.value === "number" ? base.value : Number(String(base.value).split(/[–-]/)[0]);
    const isTotal = /total/i.test(base.label);
    const mine = isTotal ? rec.total_cost_pln : rec.flight_cost_pln;
    if (Number.isFinite(low) && mine < low)
      matches.push({
        text: isTotal ? "Cheaper than the seasonal median for this trip" : "Flight below the typical fare range for this route",
        dna: high("q9"),
        evidence: cite(isTotal ? ["flight", "hotel", "price_baseline"] : ["flight", "price_baseline"]),
      });
  }
  if (high("q7").length && (tags.has("hiking") || ACTIVE.test(sights)))
    matches.push({ text: "Good for being active outdoors", dna: ["q7"], evidence: tags.has("hiking") ? [] : cite(["attraction"]) });

  // --- concerns ----------------------------------------------------------------------
  if (Number.isFinite(crowd) && crowd >= 0.45 && (crowdHaters.length || dislikesCrowds))
    concerns.push({
      text: crowdHaters.length
        ? `Crowd index ${crowd} of peak, and you said you like travelling away from crowds`
        : `Crowd index ${crowd} of peak, and you listed crowds as a dislike`,
      dna: crowdHaters,
      evidence: cite(["crowds"]),
      severity: 2,
    });
  if (high("q6").length && tags.has("nightlife"))
    concerns.push({ text: "Known for nightlife, but you're mostly after rest", dna: ["q6"], evidence: cite(["attraction"]), severity: 2 });
  if (Number.isFinite(temp) && (temp < lo || temp > hi))
    concerns.push({
      text: `Around ${temp} °C, outside your comfortable range`,
      dna: [],
      evidence: cite(["weather"]),
      severity: temp < lo - 4 || temp > hi + 4 ? 2 : 1,
    });
  const rainIdx = rec.evidence.findIndex((e) => e.kind === "weather" && e.unit === "days");
  const rain = rainIdx >= 0 ? num(rec.evidence[rainIdx].value) : Number.NaN;
  if (Number.isFinite(rain) && rain >= 5)
    concerns.push({ text: `About ${rain} rainy days expected in the window`, dna: high("q7"), evidence: [rainIdx], severity: 1 });
  if (profile.budget_pln != null && rec.total_cost_pln > profile.budget_pln)
    concerns.push({
      text: "Over your budget",
      dna: high("q9"),
      evidence: cite(["flight", "hotel"]),
      severity: high("q9").length ? 2 : 1,
    });

  // --- label: score band, capped by the concerns -------------------------------------------
  let level = LABELS.indexOf(labelFromScore(rec.score.total));
  const serious = concerns.filter((c) => c.severity >= 2).length;
  if (serious >= 2 || (serious >= 1 && rec.score.total < 0.7)) level = Math.min(level, 0);
  else if (serious === 1) level = Math.min(level, 1);
  else if (concerns.length >= 2) level = Math.min(level, 2);
  const label = LABELS[level];

  const scoreHigh = rec.score.total >= 0.75;
  let summary: string;
  if (scoreHigh && level <= 1 && concerns[0]) summary = `Scores well, but ${lowerFirst(concerns[0].text)}.`;
  else if (level >= 2 && matches[0]) summary = `${matches[0].text}.`;
  else if (concerns[0]) summary = `${concerns[0].text}.`;
  else summary = "No strong signals either way from your Travel DNA.";

  return {
    label,
    confidence: 0.6,
    summary: neutral ? `${summary} (Checked against neutral DNA.)` : summary,
    matches: matches.filter((m) => m.dna.length || m.evidence.length),
    concerns: concerns.filter((c) => c.dna.length || c.evidence.length).map((c) => ({ text: c.text, dna: c.dna, evidence: c.evidence })),
    model,
    inputs_hash: "inputs_hash" in rec ? String((rec as { inputs_hash?: string }).inputs_hash ?? "") : "",
    created_at: null,
  };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Attach a verdict where the backend didn't send one (fixture mode, or until the fit agent ships). */
export function withFit<T extends Recommendation>(recs: T[], profile: TasteProfile, model: string): T[] {
  return recs.map((r) => (r.fit ? r : { ...r, fit: rulesFit(r, profile, model) }));
}
