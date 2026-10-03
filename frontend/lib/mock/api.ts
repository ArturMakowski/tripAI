/**
 * In-browser stand-in for the FastAPI backend (API v0). Same request/response
 * shapes as backend/src/tripai/api; deterministic, no network. Used when
 * NEXT_PUBLIC_API_URL is unset or the backend is unreachable.
 */
import { flipConditions, normalise, rerank, FACTORS, type Factor } from "../scoring";
import type {
  BridgeWindow,
  Change,
  ChatMessage,
  FeedbackRequest,
  FeedbackResponse,
  FreeWindow,
  InterviewResult,
  LuxuryLevel,
  RankedRecommendation,
  RecommendationsRequest,
  TasteProfile,
  Weights,
} from "../types";
import { buildRecommendations, CITY_TAGS, DEMO_PROFILE, LONG_WEEKENDS, WINDOWS } from "./fixtures";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_WEIGHTS: Weights = { price: 0.4, weather: 0.2, crowds: 0.15, taste: 0.25 };

// --- /interview -----------------------------------------------------------------

export const INTERVIEW_OPENER =
  "Hi, I'm TripAI. Four quick questions and I'll start watching for trips that suit you. What do you love doing when you travel?";

const CHIPS = {
  interests: ["Food & markets", "History & museums", "Art & architecture", "Beaches", "Nightlife", "Hiking"],
  avoid: ["Crowds", "Heat", "Cold", "Long layovers", "Nothing really"],
  budget: ["Under 1,500 PLN", "About 1,800 PLN", "About 3,000 PLN", "Not sure"],
  origin: ["KRK, simple is fine", "KRK, comfortable", "KTW, budget", "WAW, treat myself"],
  comfort: ["Budget", "Standard", "Comfort", "Luxury"],
  climate: ["Mild, 15–24 °C", "Warm, 22–30 °C", "Cool is fine", "Avoid heat"],
  length: ["A long weekend", "4–5 days", "About a week"],
};

/** Quick-reply chips per interview step (UI-only; the backend returns plain text). */
export const SUGGESTIONS: string[][] = [CHIPS.interests, CHIPS.avoid, CHIPS.budget, CHIPS.origin];

/**
 * Chips for whatever the assistant just asked. The live LLM picks its own question
 * order, so match on the question text and fall back to the scripted step.
 */
export function suggestionsFor(question: string, step: number): string[] {
  const q = question.toLowerCase();
  const rules: [RegExp, string[]][] = [
    [/budget|pln|spend|price|cost/, CHIPS.budget],
    [/airport|fly from|depart|city do you/, CHIPS.origin],
    [/comfort|luxury|hotel|stay|accommodation/, CHIPS.comfort],
    [/temperature|climate|weather|warm|°c/, CHIPS.climate],
    [/avoid|ruin|dislike|hate|anything you/, CHIPS.avoid],
    [/how long|days|length|nights/, CHIPS.length],
    [/love|enjoy|interest|like doing|what do you/, CHIPS.interests],
  ];
  return rules.find(([re]) => re.test(q))?.[1] ?? SUGGESTIONS[step] ?? [];
}

const QUESTIONS = [
  "Good to know. Is there anything that ruins a trip for you?",
  "What's your all-in budget per person for a 3–6 day trip, including flights and stay?",
  "Last one: which airport do you fly from, and how comfortable should the stay be?",
];

const INTEREST_KEYWORDS: [RegExp, string, number][] = [
  [/food|market|eat|cuisine|wine/i, "food", 0.9],
  [/histor|museum|ancient|ruin/i, "history", 0.85],
  [/art|galler/i, "art", 0.7],
  [/architect/i, "architecture", 0.7],
  [/beach|sea|swim/i, "beach", 0.8],
  [/night|bar|party|club/i, "nightlife", 0.75],
  [/hik|nature|mountain/i, "nature", 0.8],
  [/walk/i, "walking", 0.6],
];

function extractProfile(userTexts: string[]): TasteProfile {
  const [likes = "", avoid = "", budget = "", origin = ""] = userTexts;
  const interests: Record<string, number> = {};
  for (const [re, tag, wgt] of INTEREST_KEYWORDS) if (re.test(likes)) interests[tag] = wgt;
  if (Object.keys(interests).length === 0) Object.assign(interests, DEMO_PROFILE.interests);
  interests.walking ??= 0.5;
  interests.architecture ??= 0.5;

  const dislikes: string[] = [];
  if (/crowd/i.test(avoid)) dislikes.push("crowds");
  if (/heat|hot/i.test(avoid)) dislikes.push("heat");
  if (/cold/i.test(avoid)) dislikes.push("cold");
  if (/layover|connection/i.test(avoid)) dislikes.push("long layovers");

  const num = budget.replace(/[\s,]/g, "").match(/\d{3,5}/);
  const budget_pln = num ? Number(num[0]) : null;

  const airport = origin.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0] ?? "KRK";
  let luxury: LuxuryLevel = "standard";
  if (/budget|cheap|simple|hostel/i.test(origin)) luxury = "budget";
  if (/comfort/i.test(origin)) luxury = "comfort";
  if (/treat|luxur|5\*|five/i.test(origin)) luxury = "luxury";

  return { ...DEMO_PROFILE, user_id: "demo", origin_airports: [airport], budget_pln, luxury, interests, dislikes };
}

export async function interview(messages: ChatMessage[]): Promise<InterviewResult> {
  await sleep(650);
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.content);
  const step = userTexts.length;
  if (step === 0) return { reply: INTERVIEW_OPENER, profile: null };
  if (step <= QUESTIONS.length) return { reply: QUESTIONS[step - 1], profile: null };
  return {
    reply: "That's everything I need. Here's what I picked up. Tap anything that's wrong and I'll use your edits from now on.",
    profile: extractProfile(userTexts),
  };
}

// --- /windows, /windows/long-weekends ----------------------------------------------------

const inRange = (w: FreeWindow, from?: string, to?: string) => (!from || w.end >= from) && (!to || w.start <= to);

export async function windows(from?: string, to?: string): Promise<FreeWindow[]> {
  await sleep(250);
  return WINDOWS.filter((w) => inRange(w, from, to));
}

export async function longWeekends(from?: string, to?: string): Promise<BridgeWindow[]> {
  await sleep(250);
  return LONG_WEEKENDS.filter((b) => inRange(b.window, from, to));
}

// --- /recommendations -------------------------------------------------------------------

/** Taste fit = interest-weighted match against the city's tag vector. */
export function tasteFit(profile: TasteProfile, iata: string): number {
  const tags = CITY_TAGS[iata] ?? {};
  let num = 0;
  let den = 0;
  for (const [tag, wgt] of Object.entries(profile.interests)) {
    num += wgt * (tags[tag] ?? 0.3);
    den += wgt;
  }
  return den ? Math.round((num / den) * 100) / 100 : 0.5;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Adds the rank-dependent receipt parts: runner-up counterfactual and flip hint. */
export function withReceipts(ranked: RankedRecommendation[], weights: Weights): RankedRecommendation[] {
  const n = normalise(weights);
  return ranked.map((r, i) => {
    const rival = i === 0 ? ranked[1] : ranked[i - 1];
    if (!rival) return r;
    const [hi, lo] = i === 0 ? [r, rival] : [rival, r];
    const flips = flipConditions(hi, lo, weights);
    const f = flips.find((x) => x.deltaPts > 0) ?? flips[0];
    const flip = f
      ? {
          rival_id: rival.id,
          rival_city: rival.city,
          factor: f.factor,
          weight_from: r2(n[f.factor]),
          weight_to: r2(n[f.factor] + f.deltaPts / 100),
          price_increase_pln: null,
          text: `${lo.city} would overtake ${hi.city} with: ${f.factor} weight ${r2(n[f.factor])} -> ${r2(n[f.factor] + f.deltaPts / 100)}`,
        }
      : null;
    const next = ranked[1];
    const runnerUp =
      i === 0 && next
        ? [
            {
              kind: "runner_up" as const,
              label: `runner-up ${next.city}`,
              city: next.city,
              window: next.window,
              total_cost_pln: next.total_cost_pln,
              cost_delta_pln: next.total_cost_pln - r.total_cost_pln,
              cost_delta_pct: Math.round((100 * (next.total_cost_pln - r.total_cost_pln)) / next.total_cost_pln),
              score_total: next.score.total,
              score_delta: r.score.total - next.score.total,
              crowd: next.crowd,
              temp_c: next.temp_c,
              text: `runner-up ${next.city}`,
            },
          ]
        : [];
    return { ...r, flip, counterfactuals: [...r.counterfactuals.filter((c) => c.kind !== "runner_up"), ...runnerUp] };
  });
}

export function scoreLocally(profile: TasteProfile, weights: Weights, windowsIn?: FreeWindow[] | null): RankedRecommendation[] {
  const recs = buildRecommendations()
    .filter((r) => !windowsIn?.length || windowsIn.some((w) => w.start === r.window.start))
    .map((r) => ({ ...r, score: { ...r.score, taste: tasteFit(profile, r.iata) } }));
  return withReceipts(rerank(recs, weights), weights);
}

export async function recommendations(req: RecommendationsRequest): Promise<RankedRecommendation[]> {
  await sleep(500);
  return scoreLocally(req.profile, req.weights ?? DEFAULT_WEIGHTS, req.windows).slice(0, req.limit ?? 10);
}

// --- /feedback --------------------------------------------------------------------------

const ALIASES: Record<string, Factor> = { price: "price", value: "price", weather: "weather", crowds: "crowds", taste: "taste" };

/** Same rules as backend scoring/feedback.py: factor rated <=2 -> weight +0.1 per point below 3, etc. */
export function applyFeedback(profile: TasteProfile, weights: Weights, req: FeedbackRequest): FeedbackResponse {
  // Travel DNA y2 = No: feedback never changes the profile (user control).
  if (profile.personalize === false) {
    const w = normalise(weights);
    return { ...profile, trip_id: req.trip_id, weights: w, diff: [], profile };
  }
  const before = normalise(weights);
  const raw = { ...before };
  const interests = { ...profile.interests };
  const dislikes = [...profile.dislikes];
  const diff: Change[] = [];
  const label = "Barcelona";

  for (const [key, val] of Object.entries(req.answers)) {
    if ((key === "loved" || key === "liked") && Array.isArray(val)) {
      for (const t of val) {
        const old = interests[t] ?? null;
        const next = r2(Math.min(1, (old ?? 0.5) + 0.2));
        if (next !== old) {
          interests[t] = next;
          diff.push({ field: `interests.${t}`, before: old, after: next, reason: `you loved ${t} on ${label}` });
        }
      }
      continue;
    }
    const f = ALIASES[key];
    if (!f || typeof val !== "number") continue;
    if (val <= 2) raw[f] += 0.1 * (3 - val);
    if (f === "crowds" && val === 1 && !dislikes.includes("crowds")) {
      diff.push({ field: "dislikes", before: [...dislikes], after: [...dislikes, "crowds"], reason: "crowds rated 1/5" });
      dislikes.push("crowds");
    }
  }

  const after = normalise(raw);
  const wDiff: Change[] = FACTORS.filter((f) => Math.abs(after[f] - before[f]) >= 0.005).map((f) => ({
    field: `weights.${f}`,
    before: r2(before[f]),
    after: r2(after[f]),
    reason: raw[f] > before[f] ? `${f} rated ${req.answers[f]}/5 on ${label}` : "renormalised",
  }));

  const nextProfile = { ...profile, interests, dislikes };
  const w = { price: r2(after.price), weather: r2(after.weather), crowds: r2(after.crowds), taste: r2(after.taste) };
  return { ...nextProfile, trip_id: req.trip_id, weights: w, diff: [...wDiff, ...diff], profile: nextProfile };
}

export async function feedback(req: FeedbackRequest): Promise<FeedbackResponse> {
  await sleep(700);
  return applyFeedback(req.profile ?? DEMO_PROFILE, req.weights ?? DEFAULT_WEIGHTS, req);
}
