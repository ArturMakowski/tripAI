/**
 * Mirror of the backend contract:
 *  - backend/src/tripai/models.py           (shared models)
 *  - backend/src/tripai/scoring/types.py    (RankedRecommendation, Counterfactual, FlipHint)
 *  - backend/src/tripai/scoring/windows.py  (Holiday, BridgeWindow)
 *  - backend/src/tripai/scoring/feedback.py (Change)
 *  - backend/src/tripai/api/schemas.py      (request/response bodies)
 * Dates are ISO strings on the wire.
 */

// --- models.py ------------------------------------------------------------------

export type LuxuryLevel = "budget" | "standard" | "comfort" | "luxury";

export interface TasteProfile {
  user_id: string;
  origin_airports: string[];
  budget_pln: number | null; // total per person
  luxury: LuxuryLevel;
  interests: Record<string, number>; // tag -> weight 0..1
  dislikes: string[];
  preferred_temp_c: [number, number];
  trip_length_days: [number, number];
  /** Travel DNA: raw swipe answers q1..q12 -> 1..5, plus derived traits (pace, novelty). */
  traits?: Record<string, number>;
  daily_discovery?: boolean | null;
  /** false: neutral weights, post-trip feedback never changes the profile. */
  personalize?: boolean;
  /** Party (docs/BUDGET.md "Party pricing"): flights x travellers, hotel per room. rooms null = ceil(people / 2). */
  adults?: number;
  children?: number;
  rooms?: number | null;
}

export interface FreeWindow {
  start: string; // ISO date
  end: string; // ISO date
  source: string; // "gcal" | "manual"
}

export interface Weights {
  price: number;
  weather: number;
  crowds: number;
  taste: number;
}

export interface Evidence {
  kind: string; // "flight" | "hotel" | "price_baseline" | "weather" | "crowds" | "holiday" | "attraction"
  label: string;
  value: number | string;
  unit: string | null;
  source: string;
  fetched_at: string; // ISO datetime
  url: string | null;
}

export interface ScoreBreakdown {
  price: number; // 0..1, higher = better
  weather: number;
  crowds: number;
  taste: number;
  total: number;
}

/** One flight segment (docs/TRIP_DETAILS.md). */
export interface FlightLeg {
  airline: string; // e.g. "Ryanair"
  flight_number: string | null; // e.g. "FR 1234"
  from_iata: string;
  to_iata: string;
  depart_at: string | null; // ISO, local time at the departure airport
  arrive_at: string | null;
  duration_min: number | null;
}

/** The concrete itinerary behind flight_cost_pln. */
export interface FlightDetails {
  outbound: FlightLeg[];
  inbound: FlightLeg[];
  stops_outbound: number | null;
  stops_inbound: number | null;
  price_pln: number | null;
  booking_url: string | null;
  source: string; // "serpapi:google_flights" | "travelpayouts" (airline code only)
  fetched_at: string;
}

export interface TransferOption {
  mode: "public_transport" | "taxi" | "drive" | "walk" | "train" | "bus" | (string & {});
  duration_min: number | null;
  distance_km: number | null;
  price_pln: number | null;
  note: string | null; // e.g. "Metro line A, 1 change"
  source: string; // "serpapi:google_hotels" | "osrm" | "estimate:haversine"
  fetched_at: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  label: string | null;
}

/** The concrete stay behind hotel_cost_pln. */
export interface HotelDetails {
  name: string;
  address: string | null;
  location: GeoPoint | null;
  rating: number | null; // e.g. 4.4
  reviews: number | null;
  stars: number | null; // hotel class
  price_pln_total: number | null;
  distance_to_center_km: number | null; // straight line to the city's centre point
  airport: GeoPoint | null;
  city_center: GeoPoint | null;
  transfers: TransferOption[]; // airport -> hotel
  booking_url: string | null;
  photo_url: string | null;
  source: string; // "serpapi:google_hotels"
  fetched_at: string;
}

export interface FitPoint {
  text: string;
  dna: string[]; // Travel DNA card ids, e.g. ["q6", "q11"]
  evidence: number[]; // indexes into Recommendation.evidence
}

/** AI second opinion vs the user's Travel DNA (docs/FIT_VERDICT.md). */
export interface FitVerdict {
  label: "great_fit" | "good_fit" | "mixed" | "poor_fit" | (string & {});
  confidence: number;
  summary: string;
  matches: FitPoint[];
  concerns: FitPoint[];
  model: string; // pydantic-ai model string, or "rules"
  inputs_hash: string;
  created_at: string | null;
}

export interface Recommendation {
  id: string; // e.g. "LIS-20270101-20270103"
  city: string;
  country: string;
  iata: string;
  window: FreeWindow;
  total_cost_pln: number;
  flight_cost_pln: number;
  hotel_cost_pln: number;
  score: ScoreBreakdown;
  evidence: Evidence[];
  highlights: string[];
  why: string;
  fit?: FitVerdict | null;
  /**
   * Party pricing (docs/BUDGET.md): flight_cost_pln is per traveller, hotel_cost_pln the whole stay for all
   * rooms, total_cost_pln stays per person; party_total_pln / per_person_pln cover the group (the UI shows
   * the sum of its lines and only cross-checks these).
   */
  travelers?: number;
  party_total_pln?: number | null;
  per_person_pln?: number | null;
  /** "exact" (these dates) | "partial" (one leg exact) | "estimate" (other dates / city average). Absent = exact. */
  price_status?: "exact" | "partial" | "estimate" | (string & {});
  value_badge?: "great_value" | "worth_splurge" | (string & {}) | null;
  value_reason?: string | null;
  flight?: FlightDetails | null; // which flight (docs/TRIP_DETAILS.md)
  hotel?: HotelDetails | null; // which hotel, where, transfers, distance to centre
}

export type PriceStatus = "exact" | "partial" | "estimate";

// --- scoring/types.py -------------------------------------------------------------

export interface Counterfactual {
  kind: "peak_season" | "next_window" | "runner_up";
  label: string;
  city: string;
  window: FreeWindow | null;
  total_cost_pln: number;
  cost_delta_pln: number; // other - this; positive = this trip is cheaper
  cost_delta_pct: number;
  score_total: number;
  score_delta: number; // this - other; positive = this trip scores higher
  crowd: number | null;
  temp_c: number | null;
  text: string;
}

/** Smallest single change that would swap this recommendation with its neighbour. */
export interface FlipHint {
  rival_id: string;
  rival_city: string;
  factor: string | null;
  weight_from: number | null;
  weight_to: number | null;
  price_increase_pln: number | null;
  text: string;
}

export interface RankedRecommendation extends Recommendation {
  rank: number;
  /** PROPOSED (issue #18): total minus the profile budget, > 0 when over; null/absent = no budget or not marked. */
  over_budget_pln?: number | null;
  counterfactuals: Counterfactual[];
  flip: FlipHint | null;
  inputs_hash: string;
  scoring_version: string;
  tags: string[];
  temp_c: number | null;
  crowd: number | null;
}

// --- scoring/windows.py -----------------------------------------------------------

export interface Holiday {
  date: string;
  name: string;
  source: string;
}

/** Długi weekend radar entry. */
export interface BridgeWindow {
  window: FreeWindow;
  total_days: number;
  leave_days: string[];
  holidays: Holiday[];
  label: string;
}

// --- scoring/feedback.py ------------------------------------------------------------

export interface Change {
  field: string; // "weights.crowds", "interests.food", "dislikes", "preferred_temp_c"
  before: number | string | string[] | null;
  after: number | string | string[] | null;
  reason: string;
}

// --- api/schemas.py + endpoint responses ----------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface InterviewRequest {
  messages: ChatMessage[];
  user_id?: string;
}

export interface InterviewResult {
  reply: string;
  profile: TasteProfile | null;
}

/** Two-phase loading (T5a): `fast` = cached/calendar prices in < 2 s, `full` = exact live prices + explanations. */
export type RecPhase = "fast" | "full";

export interface RecommendationsRequest {
  profile: TasteProfile;
  windows?: FreeWindow[] | null; // null -> calendar free windows + long-weekend radar
  weights?: Weights | null;
  limit?: number;
  explain_top?: number;
  today?: string | null;
  horizon_days?: number;
  max_leave_days?: number;
}

/** {"crowds": 2, "weather": 4, "food": 5, "loved": ["food"], "disliked": ["heat"]} */
export type FeedbackAnswers = Record<string, number | string[]>;

export interface FeedbackRequest {
  trip_id: string; // a recommendation id, or "<IATA>-..." for a past trip
  answers: FeedbackAnswers;
  user_id?: string;
  profile?: TasteProfile | null;
  weights?: Weights | null;
}

/** Updated TasteProfile at the top level, plus weights, diff and the profile nested. */
export interface FeedbackResponse extends TasteProfile {
  trip_id: string;
  weights: Weights;
  diff: Change[];
  profile: TasteProfile;
}

export interface CityInfo {
  city: string;
  country: string;
  iata: string;
  tags: string[];
  highlights: string[];
}

export interface Health {
  ok: boolean;
  provider: string;
  calendar: string;
  llm: string | null;
  scoring_version: string;
  /** PROPOSED (issue #18): phases /recommendations supports, e.g. ["fast", "full"]. Absent = single call only. */
  phases?: string[];
}

// --- profile/dna (docs/TRAVEL_DNA.md) ----------------------------------------------

export interface DnaRequest {
  user_id: string;
  answers: Record<string, number>; // q1..q12 -> 1..5
  yes_no: Record<string, boolean>; // y1, y2
}

export interface DnaReason {
  field: string; // "weights.crowds" | "interests.food" | "dislikes" | "luxury" | "traits.pace" | ...
  value: number | string | boolean | string[] | null;
  because: string[]; // card ids, e.g. ["q8", "q11"]
  text: string;
}

export interface DnaResponse {
  profile: TasteProfile;
  weights: Weights;
  reasons: DnaReason[];
}

// --- api/trips.py (T13 "My trips") ------------------------------------------------

export interface TripItem {
  id: string; // recommendation id
  kind: "approved" | "saved";
  city: string;
  country: string;
  iata: string;
  start: string;
  end: string;
  travelers: number;
  // Party money model (docs/BUDGET.md): *_pln = per person (== total_cost_pln); flight lines per traveller,
  // hotel lines the whole stay, party = flight × travellers + hotel. Lines are null on rows saved before they were recorded.
  saved_pln: number; // per person all-in when approved / saved
  saved_flight_pln: number | null;
  saved_hotel_pln: number | null;
  saved_party_pln: number | null;
  saved_price_status: PriceStatus;
  saved_at: string;
  watched: boolean; // re-priced by the daily scan
  current_pln: number | null; // latest scan check (per person); null = not checked yet / no price now
  current_flight_pln: number | null;
  current_hotel_pln: number | null;
  current_party_pln: number | null;
  current_travelers: number | null; // the party the scan priced
  price_status: PriceStatus | null;
  checked_at: string | null;
  change_pln: number | null; // current - saved per person; only exact-date prices for the same party size
  target_pln: number | null; // per person
}

export interface TripsResponse {
  planned: TripItem[];
  past: TripItem[];
  max_watched: number;
}
