/**
 * Fixture stand-in for POST /profile/dna (backend tripai.profile.dna, T1b), using
 * the formulas from docs/TRAVEL_DNA.md verbatim. Used only when the backend
 * route is missing or unreachable; the UI never derives the profile itself.
 */
import type { DnaReason, DnaRequest, DnaResponse, LuxuryLevel, TasteProfile, Weights } from "../types";

const DEFAULT_WEIGHTS: Weights = { price: 0.4, weather: 0.2, crowds: 0.15, taste: 0.25 };
const QS = Array.from({ length: 12 }, (_, i) => `q${i + 1}`);

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const avg = (...xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function profileDna(req: DnaRequest, base?: Partial<TasteProfile>): DnaResponse {
  const a = (q: string) => {
    const v = req.answers[q];
    return typeof v === "number" && v >= 1 && v <= 5 ? v : 3; // missing answer = 3
  };
  const n = (q: string) => (a(q) - 1) / 4;
  const personalize = req.yes_no.y2 ?? true;
  const reasons: DnaReason[] = [];
  const why = (field: string, value: DnaReason["value"], because: string[], text: string) =>
    reasons.push({ field, value, because, text });

  // --- weights -----------------------------------------------------------------------
  let weights: Weights;
  if (personalize) {
    const raw = {
      price: 0.25 + 0.35 * n("q9") - 0.15 * n("q10"),
      weather: 0.2 + 0.05 * n("q6"),
      crowds: 0.1 + 0.2 * avg(n("q8"), n("q11")),
      taste: 0.2 + 0.15 * n("q4") + 0.1 * n("q10"),
    };
    const sum = raw.price + raw.weather + raw.crowds + raw.taste;
    weights = { price: r4(raw.price / sum), weather: r4(raw.weather / sum), crowds: r4(raw.crowds / sum), taste: r4(raw.taste / sum) };
    why("weights.price", weights.price, ["q9", "q10"], "price = 0.25 + 0.35·n(q9) − 0.15·n(q10), normalised");
    why("weights.weather", weights.weather, ["q6"], "weather = 0.20 + 0.05·n(q6), normalised");
    why("weights.crowds", weights.crowds, ["q8", "q11"], "crowds = 0.10 + 0.20·avg(n(q8), n(q11)), normalised");
    why("weights.taste", weights.taste, ["q4", "q10"], "taste = 0.20 + 0.15·n(q4) + 0.10·n(q10), normalised");
  } else {
    weights = { ...DEFAULT_WEIGHTS };
    for (const f of ["price", "weather", "crowds", "taste"] as const)
      why(`weights.${f}`, weights[f], ["y2"], "neutral default weights: you chose no tailoring");
  }

  // --- interests ---------------------------------------------------------------------
  const discovery = avg(n("q1"), 1 - n("q12"));
  const interests: Record<string, number> = {
    food: r2(n("q5")),
    culture: r2(n("q5")),
    history: r2(0.8 * n("q5")),
    beach: r2(n("q6")),
    wellness: r2(n("q6")),
    hiking: r2(n("q7")),
    nature: r2(Math.max(n("q7"), 0.6 * n("q6"))),
    offbeat: r2(avg(n("q8"), n("q11"))),
    discovery: r2(discovery),
  };
  const src: Record<string, string[]> = {
    food: ["q5"],
    culture: ["q5"],
    history: ["q5"],
    beach: ["q6"],
    wellness: ["q6"],
    hiking: ["q7"],
    nature: n("q7") >= 0.6 * n("q6") ? ["q7"] : ["q6"],
    offbeat: ["q8", "q11"],
    discovery: ["q1", "q12"],
  };
  for (const [tag, v] of Object.entries(interests)) why(`interests.${tag}`, v, src[tag], `interest in ${tag}`);

  // --- dislikes, luxury, traits --------------------------------------------------------
  const dislikes = a("q8") >= 4 || a("q11") >= 4 ? ["crowds"] : [];
  if (dislikes.length) why("dislikes", dislikes, ["q8", "q11"].filter((q) => a(q) >= 4), "avoid crowds: q8 ≥ 4 or q11 ≥ 4");

  let luxury: LuxuryLevel = "standard";
  let luxBecause = ["q4", "q9", "q10"];
  if (a("q9") >= 4 && a("q10") <= 2) [luxury, luxBecause] = ["budget", ["q9", "q10"]];
  else if (a("q10") >= 4 && a("q4") <= 2) [luxury, luxBecause] = ["luxury", ["q10", "q4"]];
  else if (a("q4") <= 2) [luxury, luxBecause] = ["comfort", ["q4"]];
  why("luxury", luxury, luxBecause, `stay level: ${luxury}`);

  const pace = r2(n("q2") - n("q3"));
  const traits: Record<string, number> = Object.fromEntries(QS.map((q) => [q, a(q)]));
  traits.pace = pace;
  traits.novelty = r2(discovery);
  const paceLabel = pace > 0.25 ? "structured" : pace < -0.25 ? "spontaneous" : "balanced";
  why("traits.pace", pace, ["q2", "q3"], `pace: ${paceLabel}`);
  why("traits.novelty", traits.novelty, ["q1", "q12"], "novelty = discovery");

  const daily = req.yes_no.y1 ?? null;
  if (daily != null) why("daily_discovery", daily, ["y1"], daily ? "a new attraction every day" : "no daily novelty needed");
  why(
    "personalize",
    personalize,
    ["y2"],
    personalize ? "recommendations adapt to your style" : "recommendations won't adapt; feedback won't change your profile",
  );

  const profile: TasteProfile = {
    user_id: req.user_id,
    origin_airports: base?.origin_airports ?? ["KRK"],
    budget_pln: base?.budget_pln ?? null,
    luxury,
    interests,
    dislikes,
    preferred_temp_c: base?.preferred_temp_c ?? [15, 26],
    trip_length_days: base?.trip_length_days ?? [3, 7],
    traits,
    daily_discovery: daily,
    personalize,
  };
  return { profile, weights, reasons };
}
