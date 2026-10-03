/**
 * In-browser stand-in for the FastAPI backend (API v0). Same request/response
 * shapes; deterministic, no network. Used when NEXT_PUBLIC_API_URL is unset.
 */
import { DEFAULT_WEIGHTS, normalise, rerank } from "../scoring";
import type {
  ChatMessage,
  FeedbackRequest,
  FeedbackResponse,
  FreeWindow,
  InterviewResponse,
  LuxuryLevel,
  Recommendation,
  RecommendationsRequest,
  TasteProfile,
  Weights,
} from "../types";
import { buildRecommendations, CITY_TAGS, DEMO_PROFILE, WINDOWS } from "./fixtures";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- /interview ---------------------------------------------------------------

export const INTERVIEW_OPENER: InterviewResponse = {
  reply:
    "Hi, I'm TripAI. Four quick questions and I'll start watching for trips that suit you. What do you love doing when you travel?",
  suggestions: ["Food & markets", "History & museums", "Art & architecture", "Beaches", "Nightlife", "Hiking"],
};

const QUESTIONS: InterviewResponse[] = [
  {
    reply: "Good to know. Is there anything that ruins a trip for you?",
    suggestions: ["Crowds", "Heat", "Long layovers", "Early flights", "Nothing really"],
  },
  {
    reply: "What's your all-in budget per person for a 3–6 day trip, including flights and stay?",
    suggestions: ["Under 1,500 PLN", "About 1,800 PLN", "About 3,000 PLN", "Not sure"],
  },
  {
    reply: "Last one: which airport do you fly from, and how comfortable should the stay be?",
    suggestions: ["KRK, simple is fine", "KRK, comfortable", "KTW, budget", "WAW, treat myself"],
  },
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
  // gentle defaults so taste-fit has something to compare against
  interests.walking ??= 0.5;
  interests.architecture ??= 0.5;

  const dislikes: string[] = [];
  if (/crowd/i.test(avoid)) dislikes.push("crowds");
  if (/heat|hot/i.test(avoid)) dislikes.push("heat");
  if (/layover|connection/i.test(avoid)) dislikes.push("long layovers");
  if (/early/i.test(avoid)) dislikes.push("early flights");

  const num = budget.replace(/[\s,]/g, "").match(/\d{3,5}/);
  const budget_pln = num ? Number(num[0]) : null;

  const airport = origin.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0] ?? "KRK";
  let luxury: LuxuryLevel = "standard";
  if (/budget|cheap|simple|hostel/i.test(origin)) luxury = "budget";
  if (/comfort/i.test(origin)) luxury = "comfort";
  if (/treat|luxur|5\*|five/i.test(origin)) luxury = "luxury";

  return {
    ...DEMO_PROFILE,
    user_id: "demo-user",
    origin_airports: [airport],
    budget_pln,
    luxury,
    interests,
    dislikes,
  };
}

export async function interview(messages: ChatMessage[]): Promise<InterviewResponse> {
  await sleep(650);
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.content);
  const step = userTexts.length; // 1 answer -> question 2, ...
  if (step === 0) return INTERVIEW_OPENER;
  if (step <= QUESTIONS.length) return QUESTIONS[step - 1];
  return {
    reply:
      "That's everything I need. Here's what I picked up. Tap anything that's wrong and I'll use your edits from now on.",
    profile: extractProfile(userTexts),
  };
}

// --- /windows -----------------------------------------------------------------

export async function windows(from?: string, to?: string): Promise<FreeWindow[]> {
  await sleep(300);
  return WINDOWS.filter((w) => (!from || w.end >= from) && (!to || w.start <= to));
}

// --- /recommendations -----------------------------------------------------------

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

export function scoreLocally(profile: TasteProfile, weights: Weights, windowsIn?: FreeWindow[]): Recommendation[] {
  const recs = buildRecommendations()
    .filter((r) => !windowsIn?.length || windowsIn.some((w) => w.start === r.window.start))
    .map((r) => ({ ...r, score: { ...r.score, taste: tasteFit(profile, r.iata) } }));
  return rerank(recs, weights);
}

export async function recommendations(req: RecommendationsRequest): Promise<Recommendation[]> {
  await sleep(500);
  return scoreLocally(req.profile, req.weights, req.windows);
}

// --- /feedback ------------------------------------------------------------------

/**
 * Deterministic update rule: a low rating on a factor (1-2 of 5) means it hurt
 * the trip, so we weight it more next time; liked tags nudge interests up.
 */
export function applyFeedback(
  profile: TasteProfile,
  weights: Weights,
  req: FeedbackRequest,
): FeedbackResponse {
  const r = req.answers.ratings;
  const bump = (rating: number | undefined) => (rating == null ? 0 : Math.max(0, 3 - rating) * 0.15);
  const next = normalise({
    price: weights.price + bump(r.price),
    weather: weights.weather + bump(r.weather),
    crowds: weights.crowds + bump(r.crowds),
    taste: weights.taste + bump(r.taste),
  });
  const round = (x: number) => Math.round(x * 100) / 100;

  const interests = { ...profile.interests };
  for (const tag of req.answers.liked_tags) interests[tag] = round(Math.min(1, (interests[tag] ?? 0.4) + 0.1));

  const dislikes = new Set(profile.dislikes);
  if ((r.crowds ?? 3) <= 2) dislikes.add("crowds");
  if ((r.weather ?? 3) <= 2) dislikes.add("heat");

  return {
    profile: { ...profile, interests, dislikes: [...dislikes] },
    weights: { price: round(next.price), weather: round(next.weather), crowds: round(next.crowds), taste: round(next.taste) },
  };
}

export async function feedback(
  req: FeedbackRequest,
  ctx: { profile: TasteProfile; weights: Weights } = { profile: DEMO_PROFILE, weights: DEFAULT_WEIGHTS },
): Promise<FeedbackResponse> {
  await sleep(700);
  return applyFeedback(ctx.profile, ctx.weights, req);
}
