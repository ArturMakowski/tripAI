/**
 * Mirror of backend/src/tripai/models.py (the shared contract).
 * Keep the first section 1:1 with the Python models; dates are ISO strings on the wire.
 */

// ---------------------------------------------------------------------------
// models.py mirror
// ---------------------------------------------------------------------------

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
}

export interface FreeWindow {
  start: string; // ISO date
  end: string; // ISO date
  source: string; // "gcal" | "manual"
  /** Proposed extension (not yet in models.py), see PROPOSED below. */
  bridge?: BridgeInfo | null;
}

export interface Weights {
  price: number;
  weather: number;
  crowds: number;
  taste: number;
}

export type EvidenceKind =
  | "flight"
  | "hotel"
  | "weather"
  | "crowds"
  | "holiday"
  | "attraction"
  | (string & {});

export interface Evidence {
  kind: EvidenceKind;
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

export interface Recommendation extends ProposedRecommendationFields {
  id: string;
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
}

// ---------------------------------------------------------------------------
// API v0 request/response shapes (docs/ARCHITECTURE.md)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface InterviewResponse {
  reply: string;
  profile?: TasteProfile | null;
  /** Proposed: quick-reply chips the UI can offer. */
  suggestions?: string[];
}

export interface RecommendationsRequest {
  profile: TasteProfile;
  windows?: FreeWindow[];
  weights: Weights;
}

export interface SurveyAnswers {
  /** 1..5 per factor; free-text note optional. */
  ratings: Record<string, number>;
  liked_tags: string[];
  note?: string;
}

export interface FeedbackRequest {
  trip_id: string;
  answers: SurveyAnswers;
}

/**
 * Backend v0 returns a bare TasteProfile. The proposed shape also returns the
 * updated weights so the UI can show the diff; the client accepts both.
 */
export interface FeedbackResponse {
  profile: TasteProfile;
  weights?: Weights;
}

// ---------------------------------------------------------------------------
// PROPOSED contract extensions — not in models.py yet (see PR body).
// All optional: the UI derives a client-side fallback when they are missing.
// ---------------------------------------------------------------------------

export interface BridgeInfo {
  holiday: string; // "Boże Ciało"
  days_off: number; // vacation days to take
  total_days: number; // resulting trip length
  take_off: string[]; // ISO dates to request off
}

export interface Delta {
  vs: "summer" | "next_best";
  label: string; // "vs. July", "vs. 6–10 Jan"
  cost_pln: number; // signed, negative = cheaper now
  score: number | null; // signed total-score difference
  source: string;
  fetched_at: string;
}

export interface ProposedRecommendationFields {
  photo_url?: string | null;
  deltas?: Delta[];
  flip_conditions?: string[];
  inputs_hash?: string | null;
  handoff?: { label: string; url: string }[];
}
