/**
 * Realistic demo fixtures: KRK -> Rome / Lisbon / Athens / Venice / Porto, Jan 2027.
 * Prices are hand-recorded ballparks for the demo, shaped exactly like backend output.
 */
import type { BridgeWindow, Counterfactual, Evidence, FreeWindow, RankedRecommendation, TasteProfile } from "../types";

const FETCHED = "2026-10-03T09:42:00Z";
const FETCHED_SEED = "2026-10-02T21:10:00Z";

export const DEMO_PROFILE: TasteProfile = {
  user_id: "demo-artur",
  origin_airports: ["KRK"],
  budget_pln: 1800,
  luxury: "standard",
  interests: { food: 0.9, history: 0.8, art: 0.6, architecture: 0.6, walking: 0.5, beach: 0.2, nightlife: 0.2 },
  dislikes: ["long layovers"],
  preferred_temp_c: [12, 24],
  trip_length_days: [3, 6],
  // Travel DNA answers (docs/TRAVEL_DNA.md): a foodie who avoids crowds and watches the price.
  traits: { q1: 5, q2: 4, q3: 2, q4: 4, q5: 5, q6: 2, q7: 3, q8: 4, q9: 4, q10: 3, q11: 5, q12: 2, pace: 0.5, novelty: 0.88 },
  daily_discovery: true,
  personalize: true,
};

const NAGER = "builtin:pl-holidays";
const hol = (date: string, name: string) => ({ date, name, source: NAGER });

/** GET /windows: free days from the (fixture) calendar. */
export const WINDOWS: FreeWindow[] = [
  { start: "2027-01-01", end: "2027-01-03", source: "gcal" },
  { start: "2027-01-14", end: "2027-01-19", source: "gcal" },
  { start: "2027-01-23", end: "2027-01-24", source: "gcal" },
];

/** GET /windows/long-weekends: długi weekend radar. */
export const LONG_WEEKENDS: BridgeWindow[] = [
  {
    window: { start: "2027-01-01", end: "2027-01-03", source: "manual" },
    total_days: 3,
    leave_days: [],
    holidays: [hol("2027-01-01", "Nowy Rok")],
    label: "3 days off with no leave: Fri 1 Jan - Sun 3 Jan (Nowy Rok)",
  },
  {
    window: { start: "2027-01-06", end: "2027-01-10", source: "manual" },
    total_days: 5,
    leave_days: ["2027-01-07", "2027-01-08"],
    holidays: [hol("2027-01-06", "Trzech Króli")],
    label: "Take 2 days off (Thu 7 Jan, Fri 8 Jan) -> 5 days: Wed 6 Jan - Sun 10 Jan (Trzech Króli)",
  },
  {
    window: { start: "2027-03-26", end: "2027-03-29", source: "manual" },
    total_days: 4,
    leave_days: ["2027-03-26"],
    holidays: [hol("2027-03-28", "Wielkanoc"), hol("2027-03-29", "Poniedziałek Wielkanocny")],
    label: "Take 1 day off (Fri 26 Mar) -> 4 days: Fri 26 Mar - Mon 29 Mar (Wielkanoc)",
  },
  {
    window: { start: "2027-05-27", end: "2027-05-30", source: "manual" },
    total_days: 4,
    leave_days: ["2027-05-28"],
    holidays: [hol("2027-05-27", "Boże Ciało")],
    label: "Take 1 day off (Fri 28 May) -> 4 days: Thu 27 May - Sun 30 May (Boże Ciało)",
  },
];

const ALL_WINDOWS: FreeWindow[] = [...WINDOWS, ...LONG_WEEKENDS.map((b) => b.window)];

/** City tag vectors used by the mock to compute taste fit from the profile. */
export const CITY_TAGS: Record<string, Record<string, number>> = {
  FCO: { food: 1, history: 1, art: 1, architecture: 0.9, walking: 0.8, beach: 0.1, nightlife: 0.5 },
  LIS: { food: 0.8, history: 0.6, art: 0.5, architecture: 0.7, walking: 0.9, beach: 0.6, nightlife: 0.8 },
  ATH: { food: 0.75, history: 1, art: 0.5, architecture: 0.7, walking: 0.6, beach: 0.4, nightlife: 0.5 },
  VCE: { food: 0.7, history: 0.9, art: 0.9, architecture: 1, walking: 1, beach: 0.1, nightlife: 0.2 },
  OPO: { food: 0.85, history: 0.6, art: 0.4, architecture: 0.7, walking: 0.8, beach: 0.4, nightlife: 0.6 },
};

interface Seed {
  city: string;
  country: string;
  iata: string;
  window: FreeWindow;
  flight: number;
  flightTypical: [number, number];
  hotel: number;
  nights: number;
  tempMax: number;
  rainDays: number;
  crowdIndex: number; // occupancy vs. August peak, 0..1
  score: { price: number; weather: number; crowds: number };
  highlights: string[];
  why: string;
  summerTotal: number;
  nextBest: { start: string; end: string; cost: number; score: number };
  airline: string;
}

const w = (start: string) => ALL_WINDOWS.find((x) => x.start === start)!;

const SEEDS: Seed[] = [
  {
    city: "Rome",
    country: "Italy",
    iata: "FCO",
    window: w("2027-01-14"),
    flight: 262,
    flightTypical: [310, 480],
    hotel: 1180,
    nights: 5,
    tempMax: 13.8,
    rainDays: 2,
    crowdIndex: 0.41,
    score: { price: 0.84, weather: 0.74, crowds: 0.86 },
    highlights: ["Trastevere food walk", "Vatican Museums (no queue in Jan)", "Galleria Borghese", "Testaccio market"],
    why: "Your calendar is free 14–19 Jan. Return flights from Kraków are 262 PLN, below the typical 310–480 PLN for this route, and five nights near Trastevere cost 1,180 PLN, 44% less than the same stay in July. Mid-January occupancy is 41% of the August peak, and the climate normal is 13.8 °C with about 2 rainy days. It matches your top interests: food, history and art.",
    summerTotal: 2590,
    nextBest: { start: "2027-01-06", end: "2027-01-10", cost: 1390, score: -4 },
    airline: "Ryanair",
  },
  {
    city: "Lisbon",
    country: "Portugal",
    iata: "LIS",
    window: w("2027-01-14"),
    flight: 548,
    flightTypical: [520, 790],
    hotel: 960,
    nights: 5,
    tempMax: 15.1,
    rainDays: 4,
    crowdIndex: 0.48,
    score: { price: 0.74, weather: 0.84, crowds: 0.8 },
    highlights: ["Alfama miradouros", "Time Out Market", "Belém pastries", "LX Factory"],
    why: "Your calendar is free 14–19 Jan. Lisbon is the warmest option at 15.1 °C, and five nights cost 960 PLN. Flights are 548 PLN, near the low end of the typical 520–790 PLN range. Occupancy is 48% of the summer peak.",
    summerTotal: 2780,
    nextBest: { start: "2027-01-06", end: "2027-01-10", cost: 1460, score: -3 },
    airline: "Wizz Air",
  },
  {
    city: "Athens",
    country: "Greece",
    iata: "ATH",
    window: w("2027-01-06"),
    flight: 384,
    flightTypical: [420, 690],
    hotel: 720,
    nights: 4,
    tempMax: 14.2,
    rainDays: 3,
    crowdIndex: 0.46,
    score: { price: 0.9, weather: 0.74, crowds: 0.8 },
    highlights: ["Acropolis at opening time", "Plaka tavernas", "National Archaeological Museum", "Lycabettus sunset"],
    why: "Take 7–8 Jan off and Trzech Króli gives you 5 days. Athens is the cheapest trip here at 1,104 PLN in total, and January occupancy is 46% of the summer peak, so the Acropolis is far quieter than in July. It fits your interest in history well and your interest in food a little less.",
    summerTotal: 2410,
    nextBest: { start: "2027-01-14", end: "2027-01-19", cost: 1290, score: -2 },
    airline: "Ryanair",
  },
  {
    city: "Venice",
    country: "Italy",
    iata: "VCE",
    window: w("2027-01-14"),
    flight: 298,
    flightTypical: [280, 450],
    hotel: 1420,
    nights: 5,
    tempMax: 7.4,
    rainDays: 5,
    crowdIndex: 0.29,
    score: { price: 0.72, weather: 0.38, crowds: 0.93 },
    highlights: ["Empty San Marco at dawn", "Cicchetti bars in Cannaregio", "Gallerie dell'Accademia"],
    why: "Venice is at its emptiest in January, with occupancy at 29% of the peak. That is 7 °C and damp, though, which is below your preferred 12–24 °C. Hotels are the most expensive here at 1,420 PLN for five nights.",
    summerTotal: 3350,
    nextBest: { start: "2027-01-06", end: "2027-01-10", cost: 1610, score: -6 },
    airline: "Ryanair (TSF)",
  },
  {
    city: "Porto",
    country: "Portugal",
    iata: "OPO",
    window: w("2027-01-14"),
    flight: 612,
    flightTypical: [560, 820],
    hotel: 690,
    nights: 5,
    tempMax: 14.0,
    rainDays: 6,
    crowdIndex: 0.39,
    score: { price: 0.76, weather: 0.6, crowds: 0.85 },
    highlights: ["Ribeira riverside", "Port lodges in Gaia", "Livraria Lello", "Francesinha crawl"],
    why: "Porto has the cheapest hotels here at 690 PLN for five nights, and the food matches your profile. The flight costs 612 PLN and around 6 rainy days are typical in mid-January.",
    summerTotal: 2510,
    nextBest: { start: "2027-01-06", end: "2027-01-10", cost: 1240, score: -1 },
    airline: "Ryanair",
  },
];

const FIX = (s: string) => `fixture:${s}`;

export const recId = (iata: string, win: Pick<FreeWindow, "start" | "end">) =>
  `${iata}-${win.start.replaceAll("-", "")}-${win.end.replaceAll("-", "")}`;

function shortRange(win: Pick<FreeWindow, "start" | "end">) {
  const s = new Date(`${win.start}T12:00:00Z`);
  const e = new Date(`${win.end}T12:00:00Z`);
  return `${s.getUTCDate()}-${e.getUTCDate()} ${e.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

function evidenceFor(s: Seed): Evidence[] {
  const range = shortRange(s.window);
  return [
    {
      kind: "flight",
      label: `Return KRK-${s.iata} ${range} · ${s.airline}`,
      value: s.flight,
      unit: "PLN",
      source: FIX("travelpayouts"),
      fetched_at: FETCHED,
      url: null,
    },
    {
      kind: "price_baseline",
      label: "Typical return fare on this route",
      value: `${s.flightTypical[0]}–${s.flightTypical[1]}`,
      unit: "PLN",
      source: FIX("serpapi:google_flights.price_insights"),
      fetched_at: FETCHED,
      url: null,
    },
    {
      kind: "hotel",
      label: `Hotel ${s.nights} nights in ${s.city} (standard)`,
      value: s.hotel,
      unit: "PLN",
      source: FIX("liteapi"),
      fetched_at: FETCHED,
      url: null,
    },
    {
      kind: "weather",
      label: `Avg daily max in ${s.city} ${range}`,
      value: s.tempMax,
      unit: "°C",
      source: FIX("open-meteo-climate"),
      fetched_at: FETCHED,
      url: "https://open-meteo.com",
    },
    {
      kind: "weather",
      label: "Rainy days expected in window",
      value: s.rainDays,
      unit: "days",
      source: FIX("open-meteo-climate"),
      fetched_at: FETCHED,
      url: "https://open-meteo.com",
    },
    {
      kind: "crowds",
      label: "Tourist crowd index (1 = peak)",
      value: s.crowdIndex,
      unit: "0-1",
      source: FIX("eurostat-tour_occ_nim"),
      fetched_at: FETCHED_SEED,
      url: "https://ec.europa.eu/eurostat/databrowser/view/tour_occ_nim/default/table",
    },
    {
      kind: "attraction",
      label: "Top sights",
      value: s.highlights.slice(0, 3).join(", "),
      unit: null,
      source: FIX("opentripmap"),
      fetched_at: FETCHED_SEED,
      url: "https://opentripmap.com",
    },
  ];
}

/**
 * Unranked candidates in RankedRecommendation shape. `rank`, taste score,
 * totals, the runner-up counterfactual, `flip` and `inputs_hash` are filled
 * in by the mock scorer (lib/mock/api.ts), like the real `tripai.scoring.rank`.
 */
export function buildRecommendations(): RankedRecommendation[] {
  return SEEDS.map((s) => {
    const total = s.flight + s.hotel;
    const counterfactuals: Counterfactual[] = [
      {
        kind: "peak_season",
        label: "same trip in Jul (peak season)",
        city: s.city,
        window: null,
        total_cost_pln: s.summerTotal,
        cost_delta_pln: s.summerTotal - total,
        cost_delta_pct: Math.round((100 * (s.summerTotal - total)) / s.summerTotal),
        score_total: 0.55,
        score_delta: 0.27,
        crowd: 0.9,
        temp_c: 30,
        text: `${s.summerTotal - total} PLN cheaper than the same trip in Jul (peak season)`,
      },
      {
        kind: "next_window",
        label: `next-best window ${shortRange(s.nextBest)}`,
        city: s.city,
        window: { start: s.nextBest.start, end: s.nextBest.end, source: "manual" },
        total_cost_pln: s.nextBest.cost,
        cost_delta_pln: s.nextBest.cost - total,
        cost_delta_pct: Math.round((100 * (s.nextBest.cost - total)) / s.nextBest.cost),
        score_total: 0.75,
        score_delta: -s.nextBest.score / 100,
        crowd: null,
        temp_c: null,
        text: `next-best window ${shortRange(s.nextBest)}: ${s.nextBest.cost} PLN; score ${s.nextBest.score} pts`,
      },
    ];
    return {
      id: recId(s.iata, s.window),
      city: s.city,
      country: s.country,
      iata: s.iata,
      window: s.window,
      total_cost_pln: total,
      flight_cost_pln: s.flight,
      hotel_cost_pln: s.hotel,
      score: { ...s.score, taste: 0, total: 0 },
      evidence: evidenceFor(s),
      highlights: s.highlights,
      why: s.why,
      rank: 0,
      counterfactuals,
      flip: null,
      inputs_hash: "",
      scoring_version: "fixture",
      tags: Object.entries(CITY_TAGS[s.iata] ?? {})
        .filter(([, v]) => v >= 0.7)
        .map(([k]) => k),
      temp_c: s.tempMax,
      crowd: s.crowdIndex,
    };
  });
}

/** Past trip used by the post-trip survey demo (backend resolves tags from the IATA prefix). */
export const PAST_TRIP = {
  id: "BCN-20260812-20260817",
  city: "Barcelona",
  country: "Spain",
  dates: "12–17 Aug 2026",
  photo_url: "/cities/barcelona.jpg",
};

/**
 * Polish versions of the demo data the mock "backend" returns when the UI asks for `lang: "pl"`
 * (the real backend generates its text in the requested language).
 */
export const PL_LOCAL: Record<string, { city: string; country: string; why: string }> = {
  FCO: {
    city: "Rzym",
    country: "Włochy",
    why: "Masz wolne 14–19 stycznia. Loty w obie strony z Krakowa kosztują 262 zł, mniej niż typowe 310–480 zł na tej trasie, a pięć nocy przy Zatybrzu kosztuje 1180 zł, o 44% mniej niż taki sam pobyt w lipcu. W połowie stycznia obłożenie to 41% sierpniowego szczytu, a norma klimatyczna to 13,8 °C i około 2 deszczowe dni. Pasuje do Twoich głównych zainteresowań: jedzenia, historii i sztuki.",
  },
  LIS: {
    city: "Lizbona",
    country: "Portugalia",
    why: "Masz wolne 14–19 stycznia. Lizbona to najcieplejsza opcja (15,1 °C), a pięć nocy kosztuje 960 zł. Loty kosztują 548 zł, blisko dolnej granicy typowego przedziału 520–790 zł. Obłożenie to 48% letniego szczytu.",
  },
  ATH: {
    city: "Ateny",
    country: "Grecja",
    why: "Weź wolne 7–8 stycznia, a Trzech Króli da Ci 5 dni. Ateny to tutaj najtańszy wyjazd, 1104 zł łącznie, a styczniowe obłożenie to 46% letniego szczytu, więc na Akropolu jest dużo spokojniej niż w lipcu. Dobrze pasuje do Twojego zainteresowania historią, a nieco słabiej do jedzenia.",
  },
  VCE: {
    city: "Wenecja",
    country: "Włochy",
    why: "W styczniu Wenecja jest najbardziej pusta, obłożenie to 29% szczytu. Jest jednak 7 °C i wilgotno, poniżej Twojego ulubionego przedziału 12–24 °C. Hotele są tu najdroższe: 1420 zł za pięć nocy.",
  },
  OPO: {
    city: "Porto",
    country: "Portugalia",
    why: "Porto ma tutaj najtańsze hotele, 690 zł za pięć nocy, a kuchnia pasuje do Twojego profilu. Lot kosztuje 612 zł, a w połowie stycznia typowo pada przez około 6 dni.",
  },
};
