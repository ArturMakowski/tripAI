/**
 * Realistic demo fixtures: KRK -> Rome / Lisbon / Athens / Venice / Porto, Jan 2027.
 * Prices are hand-recorded ballparks for the demo, shaped exactly like backend output.
 */
import type { Evidence, FreeWindow, Recommendation, TasteProfile } from "../types";

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
};

export const WINDOWS: FreeWindow[] = [
  {
    start: "2027-01-01",
    end: "2027-01-03",
    source: "manual",
    bridge: { holiday: "Nowy Rok", days_off: 0, total_days: 3, take_off: [] },
  },
  {
    start: "2027-01-06",
    end: "2027-01-10",
    source: "manual",
    bridge: { holiday: "Trzech Króli", days_off: 2, total_days: 5, take_off: ["2027-01-07", "2027-01-08"] },
  },
  { start: "2027-01-14", end: "2027-01-19", source: "gcal", bridge: null },
  {
    start: "2027-03-26",
    end: "2027-03-29",
    source: "manual",
    bridge: { holiday: "Poniedziałek Wielkanocny", days_off: 1, total_days: 4, take_off: ["2027-03-26"] },
  },
  {
    start: "2027-05-27",
    end: "2027-05-30",
    source: "manual",
    bridge: { holiday: "Boże Ciało", days_off: 1, total_days: 4, take_off: ["2027-05-28"] },
  },
];

/** City tag vectors used by the mock to compute taste fit from the profile. */
export const CITY_TAGS: Record<string, Record<string, number>> = {
  FCO: { food: 1, history: 1, art: 1, architecture: 0.9, walking: 0.8, beach: 0.1, nightlife: 0.5 },
  LIS: { food: 0.8, history: 0.6, art: 0.5, architecture: 0.7, walking: 0.9, beach: 0.6, nightlife: 0.8 },
  ATH: { food: 0.75, history: 1, art: 0.5, architecture: 0.7, walking: 0.6, beach: 0.4, nightlife: 0.5 },
  VCE: { food: 0.7, history: 0.9, art: 0.9, architecture: 1, walking: 1, beach: 0.1, nightlife: 0.2 },
  OPO: { food: 0.85, history: 0.6, art: 0.4, architecture: 0.7, walking: 0.8, beach: 0.4, nightlife: 0.6 },
};

interface Seed {
  id: string;
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
  nextBest: { label: string; cost: number; score: number };
  flips: string[];
  airline: string;
}

const w = (start: string) => WINDOWS.find((x) => x.start === start)!;

const SEEDS: Seed[] = [
  {
    id: "rome-2027-01-14",
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
    nextBest: { label: "Rome 6–10 Jan", cost: 1390, score: -4 },
    flips: [
      "Flight price rises above 520 PLN (then Athens wins)",
      "You drop history below 0.4 in your profile",
      "Forecast closer to the date shows more than 4 rainy days",
    ],
    airline: "Ryanair",
  },
  {
    id: "lisbon-2027-01-14",
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
    nextBest: { label: "Lisbon 6–10 Jan", cost: 1460, score: -3 },
    flips: [
      "Weather weight above 35% (then Lisbon beats Rome)",
      "A sale fare under 350 PLN appears on KRK–LIS",
    ],
    airline: "Wizz Air",
  },
  {
    id: "athens-2027-01-06",
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
    nextBest: { label: "Athens 14–19 Jan", cost: 1290, score: -2 },
    flips: ["Price weight above 50% (then Athens is #1)", "Rome flights rise above 520 PLN"],
    airline: "Ryanair",
  },
  {
    id: "venice-2027-01-14",
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
    nextBest: { label: "Venice 6–10 Jan", cost: 1610, score: -6 },
    flips: ["Crowds weight above 40%", "You widen the temperature range down to 5 °C"],
    airline: "Ryanair (TSF)",
  },
  {
    id: "porto-2027-01-14",
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
    nextBest: { label: "Porto 6–10 Jan", cost: 1240, score: -1 },
    flips: ["Rain forecast drops below 3 days", "Food interest above 0.95"],
    airline: "Ryanair",
  },
];

function fmtRange(win: FreeWindow) {
  const s = new Date(win.start);
  const e = new Date(win.end);
  const m = e.toLocaleString("en-GB", { month: "short" });
  return `${s.getDate()}–${e.getDate()} ${m}`;
}

function evidenceFor(s: Seed): Evidence[] {
  const range = fmtRange(s.window);
  const from = "KRK";
  return [
    {
      kind: "flight",
      label: `Return ${from}–${s.iata} ${range} · ${s.airline}`,
      value: s.flight,
      unit: "PLN",
      source: "travelpayouts:prices_for_dates",
      fetched_at: FETCHED,
      url: `https://www.google.com/travel/flights?q=Flights%20from%20${from}%20to%20${s.iata}%20on%20${s.window.start}%20through%20${s.window.end}`,
    },
    {
      kind: "flight",
      label: `Typical price for this route`,
      value: `${s.flightTypical[0]}–${s.flightTypical[1]}`,
      unit: "PLN",
      source: "serpapi:google_flights.price_insights",
      fetched_at: FETCHED,
      url: null,
    },
    {
      kind: "hotel",
      label: `${s.nights} nights, 3★ central, 1 adult`,
      value: s.hotel,
      unit: "PLN",
      source: "serpapi:google_hotels",
      fetched_at: FETCHED,
      url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(s.city)}&checkin=${s.window.start}&checkout=${s.window.end}&group_adults=1`,
    },
    {
      kind: "weather",
      label: `Avg. daily max, ${range} (climate normal)`,
      value: s.tempMax,
      unit: "°C",
      source: "open-meteo:climate",
      fetched_at: FETCHED,
      url: "https://open-meteo.com",
    },
    {
      kind: "weather",
      label: `Rainy days expected in window`,
      value: s.rainDays,
      unit: "days",
      source: "open-meteo:climate",
      fetched_at: FETCHED,
      url: "https://open-meteo.com",
    },
    {
      kind: "crowds",
      label: `Tourist nights in January vs. August peak`,
      value: s.crowdIndex,
      unit: "0-1",
      source: "eurostat:tour_occ_nim",
      fetched_at: FETCHED_SEED,
      url: "https://ec.europa.eu/eurostat/databrowser/view/tour_occ_nim/default/table",
    },
    ...s.highlights.slice(0, 2).map<Evidence>((h) => ({
      kind: "attraction",
      label: h,
      value: "matches food/history",
      unit: null,
      source: "opentripmap",
      fetched_at: FETCHED_SEED,
      url: "https://opentripmap.com",
    })),
  ];
}

export function buildRecommendations(): Recommendation[] {
  return SEEDS.map((s) => {
    const total = s.flight + s.hotel;
    return {
      id: s.id,
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
      photo_url: `/cities/${s.city.toLowerCase()}.jpg`,
      deltas: [
        {
          vs: "summer",
          label: "vs. same trip in July",
          cost_pln: total - s.summerTotal,
          score: null,
          source: "travelpayouts:grouped_prices + serpapi:google_hotels",
          fetched_at: FETCHED,
        },
        {
          vs: "next_best",
          label: `vs. ${s.nextBest.label}`,
          cost_pln: s.nextBest.cost - total,
          score: s.nextBest.score,
          source: "tripai.scoring",
          fetched_at: FETCHED,
        },
      ],
      flip_conditions: s.flips,
      inputs_hash: null, // computed client-side
      handoff: [
        { label: "Flights on Google Flights", url: evidenceFor(s)[0].url! },
        { label: "Hotels on Booking.com", url: evidenceFor(s)[2].url! },
      ],
    };
  });
}

/** Past trip used by the post-trip survey demo. */
export const PAST_TRIP = {
  id: "barcelona-2026-08",
  city: "Barcelona",
  country: "Spain",
  dates: "12–17 Aug 2026",
  photo_url: "/cities/barcelona.jpg",
};
