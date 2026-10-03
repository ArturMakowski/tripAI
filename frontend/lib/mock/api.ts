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
  RecPhase,
  TasteProfile,
  Weights,
} from "../types";
import { getApiLang } from "../api";
import type { Lang } from "../i18n/types";
import { buildRecommendations, CITY_TAGS, DEMO_PROFILE, LONG_WEEKENDS, PL_LOCAL, WINDOWS } from "./fixtures";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_WEIGHTS: Weights = { price: 0.4, weather: 0.2, crowds: 0.15, taste: 0.25 };

// --- /interview -----------------------------------------------------------------

/** Interview copy per language: the mock answers in the language the backend would receive as `lang`. */
const INTERVIEW: Record<
  Lang,
  { opener: string; questions: string[]; done: string; chips: Record<"interests" | "avoid" | "budget" | "origin" | "comfort" | "climate" | "length", string[]> }
> = {
  en: {
    opener:
      "Hi, I'm TripAI. Four quick questions and I'll start watching for trips that suit you. What do you love doing when you travel?",
    questions: [
      "Good to know. Is there anything that ruins a trip for you?",
      "What's your all-in budget per person for a 3–6 day trip, including flights and stay?",
      "Last one: which airport do you fly from, and how comfortable should the stay be?",
    ],
    done: "That's everything I need. Here's what I picked up. Tap anything that's wrong and I'll use your edits from now on.",
    chips: {
      interests: ["Food & markets", "History & museums", "Art & architecture", "Beaches", "Nightlife", "Hiking"],
      avoid: ["Crowds", "Heat", "Cold", "Long layovers", "Nothing really"],
      budget: ["Under 1,500 PLN", "About 1,800 PLN", "About 3,000 PLN", "Not sure"],
      origin: ["KRK, simple is fine", "KRK, comfortable", "KTW, budget", "WAW, treat myself"],
      comfort: ["Budget", "Standard", "Comfort", "Luxury"],
      climate: ["Mild, 15–24 °C", "Warm, 22–30 °C", "Cool is fine", "Avoid heat"],
      length: ["A long weekend", "4–5 days", "About a week"],
    },
  },
  pl: {
    opener:
      "Cześć, tu TripAI. Cztery krótkie pytania i zacznę wypatrywać wyjazdów, które Ci pasują. Co najbardziej lubisz robić w podróży?",
    questions: [
      "Dobrze wiedzieć. Czy jest coś, co psuje Ci wyjazd?",
      "Jaki masz łączny budżet na osobę na wyjazd 3–6 dni, z lotem i noclegiem?",
      "Ostatnie: z którego lotniska latasz i jak wygodny ma być nocleg?",
    ],
    done: "To wszystko, czego potrzebuję. Oto, co zrozumiałem. Dotknij tego, co się nie zgadza, a od teraz będę korzystać z Twoich poprawek.",
    chips: {
      interests: ["Jedzenie i targi", "Historia i muzea", "Sztuka i architektura", "Plaże", "Życie nocne", "Wędrówki"],
      avoid: ["Tłumy", "Upał", "Zimno", "Długie przesiadki", "Właściwie nic"],
      budget: ["Poniżej 1500 zł", "Około 1800 zł", "Około 3000 zł", "Nie wiem"],
      origin: ["KRK, wystarczy prosto", "KRK, wygodnie", "KTW, budżetowo", "WAW, chcę się rozpieścić"],
      comfort: ["Budżetowo", "Standard", "Komfortowo", "Luksusowo"],
      climate: ["Łagodnie, 15–24 °C", "Ciepło, 22–30 °C", "Chłód mi nie przeszkadza", "Bez upałów"],
      length: ["Długi weekend", "4–5 dni", "Około tygodnia"],
    },
  },
};

export const interviewOpener = (lang: Lang = getApiLang()) => INTERVIEW[lang].opener;

/** Quick-reply chips per interview step (UI-only; the backend returns plain text). */
export const suggestionsByStep = (lang: Lang = getApiLang()): string[][] => {
  const c = INTERVIEW[lang].chips;
  return [c.interests, c.avoid, c.budget, c.origin];
};

/**
 * Chips for whatever the assistant just asked, in the UI language. The live LLM picks
 * its own question order, so match on the question text (EN or PL) and fall back to
 * the scripted step.
 */
export function suggestionsFor(question: string, step: number, lang: Lang = getApiLang()): string[] {
  const q = question.toLowerCase();
  const c = INTERVIEW[lang].chips;
  const rules: [RegExp, string[]][] = [
    [/budget|pln|spend|price|cost|budżet|zł|wydać|cen/, c.budget],
    [/airport|fly from|depart|city do you|lotnisk|wylat|latasz/, c.origin],
    [/comfort|luxury|hotel|stay|accommodation|komfort|nocleg|hotel|luksus/, c.comfort],
    [/temperature|climate|weather|warm|°c|temperatur|klimat|pogod|ciepł/, c.climate],
    [/avoid|ruin|dislike|hate|anything you|unika|psuje|nie lubisz|przeszkadza/, c.avoid],
    [/how long|days|length|nights|jak długo|dni|długość|noc/, c.length],
    [/love|enjoy|interest|like doing|what do you|lubisz|uwielbiasz|interesuje|robić/, c.interests],
  ];
  return rules.find(([re]) => re.test(q))?.[1] ?? suggestionsByStep(lang)[step] ?? [];
}

// Keywords match answers in either language (chips or free text).
const INTEREST_KEYWORDS: [RegExp, string, number][] = [
  [/food|market|eat|cuisine|wine|jedzen|targ|kuchni|wino/i, "food", 0.9],
  [/histor|museum|ancient|ruin|muze|zabyt/i, "history", 0.85],
  [/\bart\b|art &|galler|sztuk|galer/i, "art", 0.7],
  [/architect|architekt/i, "architecture", 0.7],
  [/beach|sea|swim|plaż|morz|pływa/i, "beach", 0.8],
  [/night|bar|party|club|nocne|imprez|klub/i, "nightlife", 0.75],
  [/hik|nature|mountain|wędr|natur|gór|szlak/i, "nature", 0.8],
  [/walk|spacer/i, "walking", 0.6],
];

function extractProfile(userTexts: string[]): TasteProfile {
  const [likes = "", avoid = "", budget = "", origin = ""] = userTexts;
  const interests: Record<string, number> = {};
  for (const [re, tag, wgt] of INTEREST_KEYWORDS) if (re.test(likes)) interests[tag] = wgt;
  if (Object.keys(interests).length === 0) Object.assign(interests, DEMO_PROFILE.interests);
  interests.walking ??= 0.5;
  interests.architecture ??= 0.5;

  const dislikes: string[] = [];
  if (/crowd|tłum/i.test(avoid)) dislikes.push("crowds");
  if (/heat|hot|upał|gorąc/i.test(avoid)) dislikes.push("heat");
  if (/cold|zimn|chłód/i.test(avoid)) dislikes.push("cold");
  if (/layover|connection|przesiad/i.test(avoid)) dislikes.push("long layovers");

  const num = budget.replace(/[\s,\u00a0]/g, "").match(/\d{3,5}/);
  const budget_pln = num ? Number(num[0]) : null;

  const airport = origin.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0] ?? "KRK";
  let luxury: LuxuryLevel = "standard";
  if (/budget|cheap|simple|hostel|budżet|tani|prosto/i.test(origin)) luxury = "budget";
  if (/comfort|komfort|wygodn/i.test(origin)) luxury = "comfort";
  if (/treat|luxur|5\*|five|luksus|rozpie/i.test(origin)) luxury = "luxury";

  return { ...DEMO_PROFILE, user_id: "demo", origin_airports: [airport], budget_pln, luxury, interests, dislikes };
}

export async function interview(messages: ChatMessage[], lang: Lang = getApiLang()): Promise<InterviewResult> {
  await sleep(650);
  const copy = INTERVIEW[lang];
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.content);
  const step = userTexts.length;
  if (step === 0) return { reply: copy.opener, profile: null };
  if (step <= copy.questions.length) return { reply: copy.questions[step - 1], profile: null };
  return { reply: copy.done, profile: extractProfile(userTexts) };
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
  const all = buildRecommendations();
  // Like the backend, trips must fall inside the requested windows. The sample data only prices a few
  // January 2027 dates, so for windows it doesn't cover it returns every sample trip unchanged (never re-dated);
  // the Trips header says so.
  const inside = windowsIn?.length
    ? all.filter((r) => windowsIn.some((w) => r.window.start <= w.end && r.window.end >= w.start))
    : all;
  const recs = (inside.length ? inside : all)
    .map((r) => ({ ...r, score: { ...r.score, taste: tasteFit(profile, r.iata) } }));
  return withReceipts(rerank(recs, weights), weights);
}

/**
 * Fast-phase estimates (cached calendar fares + estimated hotels), per destination.
 * Deliberately off from the exact fixture prices so the full phase visibly re-ranks.
 */
const FAST_ESTIMATE: Record<string, { flight: number; hotel: number }> = {
  FCO: { flight: 318, hotel: 1260 },
  LIS: { flight: 452, hotel: 890 },
  ATH: { flight: 405, hotel: 690 },
  VCE: { flight: 340, hotel: 1350 },
  OPO: { flight: 560, hotel: 640 },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function fastEstimates(recs: RankedRecommendation[]): RankedRecommendation[] {
  return recs.map((r) => {
    const est = FAST_ESTIMATE[r.iata];
    if (!est) return r;
    const total = est.flight + est.hotel;
    return {
      ...r,
      flight_cost_pln: est.flight,
      hotel_cost_pln: est.hotel,
      total_cost_pln: total,
      // cheaper estimate -> better price score, same scale as the scorer's price factor
      score: { ...r.score, price: Math.round(clamp01(r.score.price + (r.total_cost_pln - total) / 2000) * 1000) / 1000 },
      evidence: r.evidence.map((e) =>
        e.kind === "flight" && typeof e.value === "number"
          ? { ...e, value: est.flight, label: `${e.label} (cached calendar fare)`, source: "fixture:travelpayouts-calendar" }
          : e.kind === "hotel" && typeof e.value === "number"
            ? { ...e, value: est.hotel, label: `${e.label} (estimate)`, source: "fixture:estimate:tripai-editorial" }
            : e,
      ),
      why: "",
    };
  });
}

/** Mark trips over the profile budget the way the backend will (positive = PLN over). */
export function markBudget(recs: RankedRecommendation[], budget: number | null): RankedRecommendation[] {
  return recs.map((r) => ({ ...r, over_budget_pln: budget == null ? null : Math.max(0, Math.round(r.total_cost_pln - budget)) }));
}

export async function recommendations(req: RecommendationsRequest, phase?: RecPhase): Promise<RankedRecommendation[]> {
  // fast < 1 s, full a couple of seconds more: the shape of the real two-phase backend
  await sleep(phase === "fast" ? 700 : phase === "full" ? 2600 : 500);
  const w = req.weights ?? DEFAULT_WEIGHTS;
  let recs = scoreLocally(req.profile, w, req.windows);
  if (phase === "fast") recs = withReceipts(rerank(fastEstimates(recs), w), w);
  // No fit here: in fixture mode the verdict is derived from the *current* ranking (use-recommendations),
  // so it never goes stale when the slider re-weights locally.
  return localize(markBudget(recs, req.profile.budget_pln), getApiLang()).slice(0, req.limit ?? 10);
}

const PL_MONTH: Record<string, string> = {
  Jan: "sty", Feb: "lut", Mar: "mar", Apr: "kwi", May: "maj", Jun: "cze",
  Jul: "lip", Aug: "sie", Sep: "wrz", Oct: "paź", Nov: "lis", Dec: "gru",
};

/** Polish evidence labels (by kind/unit); data parts such as airport codes stay as they are. */
const PL_EVIDENCE: Record<string, (label: string) => string> = {
  flight: (l) => l.replace(/^Return /, "Lot w obie strony ").replace("(cached calendar fare)", "(zapisana cena z kalendarza)"),
  price_baseline: () => "Typowa cena biletu w obie strony na tej trasie",
  hotel: (l) => l.replace(/^Hotel (\d+) nights in (.+) \((\w+)\)/, "Hotel, noce: $1, $2 ($3)").replace("(estimate)", "(szacunek)"),
  "weather:°C": () => "Średnia maksymalna temperatura dzienna",
  "weather:days": () => "Spodziewane dni deszczowe w terminie",
  crowds: () => "Wskaźnik tłoku turystycznego (1 = szczyt)",
  attraction: () => "Najważniejsze atrakcje",
};

/** The real backend answers in the requested language; the mock does the same for its demo text. */
function localize(recs: RankedRecommendation[], lang: Lang): RankedRecommendation[] {
  if (lang !== "pl") return recs;
  return recs.map((r) => {
    const loc = PL_LOCAL[r.iata];
    return {
      ...r,
      ...(loc ? { city: loc.city, country: loc.country, why: r.why ? loc.why : r.why } : {}),
      evidence: r.evidence.map((e) => {
        const f = PL_EVIDENCE[`${e.kind}:${e.unit}`] ?? PL_EVIDENCE[e.kind];
        if (!f) return e;
        const label = f(e.label)
          .replace(r.city, loc?.city ?? r.city)
          .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => PL_MONTH[m] ?? m);
        return { ...e, label };
      }),
    };
  });
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
