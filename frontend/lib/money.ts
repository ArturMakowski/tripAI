/**
 * Money consistency (docs/BUDGET.md): every screen shows the same numbers for a trip.
 * card == receipt == confirm, in both phases and both languages. All three render through
 * moneyOf(); nothing else should compute a trip total.
 *
 * Party pricing (backend semantics): flight_cost_pln is per traveller, hotel_cost_pln is the whole
 * stay for all rooms. The lines on screen are flight × travellers and hotel, and the total shown is
 * ALWAYS their sum, so lines and total can never disagree. party_total_pln / per_person_pln are
 * used only when they agree with the lines (± 1 PLN); otherwise `mismatch` is set and the lines win.
 * For one traveller this is simply flight + hotel.
 */
import type { Recommendation } from "./types";

export type PriceBasis = "perPerson" | "perRoom";
export type PriceStatus = "exact" | "partial" | "estimate";

export interface MoneyView {
  travelers: number;
  rooms: number;
  /** per traveller */
  flight: number;
  /** the whole stay, all rooms (backend hotel_cost_pln) */
  hotel: number;
  /** the flight line on screen: flight × travellers */
  flightLine: number;
  /** the stay line on screen: the whole stay */
  hotelLine: number;
  /** what the whole party pays == flightLine + hotelLine, always */
  partyTotal: number;
  /** partyTotal / travelers: the headline number on cards, the receipt and confirm */
  perPerson: number;
  /** "per person" only if every line is per person; a room-priced stay makes it "per room" */
  basis: PriceBasis;
  status: PriceStatus;
  /** which legs are priced from other dates / a city average (never shown as this trip's price) */
  estimated: { flight: boolean; hotel: boolean };
  /** the backend's party/per-person totals disagreed with its own lines by ≥ 1 PLN (we show the lines' math) */
  mismatch: boolean;
}

type Priced = Pick<Recommendation, "flight_cost_pln" | "hotel_cost_pln" | "total_cost_pln" | "evidence"> &
  Partial<Pick<Recommendation, "travelers" | "party_total_pln" | "per_person_pln" | "price_status">>;

const r = (n: number) => Math.round(n);

function hotelIsPerRoom(rec: Pick<Recommendation, "evidence">): boolean {
  const ev = rec.evidence.find((e) => e.kind === "hotel");
  if (!ev) return false;
  return /per room|\/room|za pokój|\/pokój/.test(`${ev.unit ?? ""} ${ev.label}`.toLowerCase());
}

/**
 * A leg is an estimate when its price comes from other dates or a city average, not this trip.
 * Matches the live provider's labels ("Google Travel Explore, not your exact dates", "median of
 * N Aviasales cached fares, not your exact dates", `estimate:tripai-editorial`) and the fixtures.
 */
const ESTIMATE_RE =
  /^estimate:|travel_explore|travel explore|not your (exact )?dates|month(ly)? median|median of \d+ .*fares|city.?average|other dates|inne (daty|terminy)|nie (na )?twoje( dokładne)? daty|średni[aą] (w|dla) miast/i;

/** Is this flight/hotel evidence row an estimate (other dates, a city average)? */
export const estimatedLeg = (e: Pick<Recommendation["evidence"][number], "source" | "label">) => ESTIMATE_RE.test(`${e.source} ${e.label}`);

export function legEstimated(rec: Pick<Recommendation, "evidence">, kind: "flight" | "hotel"): boolean {
  const ev = rec.evidence.find((e) => e.kind === kind);
  if (!ev) return false;
  return ESTIMATE_RE.test(`${ev.source} ${ev.label}`);
}

const RANK: Record<PriceStatus, number> = { exact: 0, partial: 1, estimate: 2 };

export function moneyOf(rec: Priced, party?: { travelers: number; rooms: number }): MoneyView {
  const travelers = Math.max(1, rec.travelers ?? party?.travelers ?? 1);
  const rooms = Math.max(1, party?.rooms ?? Math.ceil(travelers / 2));
  const flight = r(rec.flight_cost_pln);
  const hotel = r(rec.hotel_cost_pln);
  const flightLine = flight * travelers;
  const hotelLine = hotel;
  // The total shown is the sum of the lines shown, full stop (the Palma bug: lines 1 410 + 848 next to a
  // total of "od ~1 553" taken from another field).
  const partyTotal = flightLine + hotelLine;
  const perPerson = r(partyTotal / travelers);
  const off = (x: number | null | undefined, want: number) => x != null && Math.abs(r(x) - want) >= 1;
  const mismatch =
    off(rec.party_total_pln, partyTotal) || off(rec.per_person_pln, perPerson) || (travelers === 1 && off(rec.total_cost_pln, perPerson));
  const estimated = { flight: legEstimated(rec, "flight"), hotel: legEstimated(rec, "hotel") };
  const declared = (["exact", "partial", "estimate"] as const).find((x) => x === rec.price_status) ?? "exact";
  const detected: PriceStatus =
    estimated.flight && estimated.hotel ? "estimate" : estimated.flight || estimated.hotel ? "partial" : "exact";
  // The more honest of the two wins: a declared "exact" (the API default) never hides evidence
  // that a leg is priced from other dates (review #31: live recs all defaulted to "exact").
  const status: PriceStatus = RANK[detected] > RANK[declared] ? detected : declared;
  return {
    travelers,
    rooms,
    flight,
    hotel,
    flightLine,
    hotelLine,
    partyTotal,
    perPerson,
    basis: hotelIsPerRoom(rec) && travelers === 1 ? "perRoom" : "perPerson",
    status,
    estimated: status === "estimate" ? { flight: true, hotel: true } : estimated,
    mismatch,
  };
}

/** People in the party from the profile (adults + children), at least 1. */
export const partySize = (p: { adults?: number; children?: number } | null | undefined) =>
  Math.max(1, (p?.adults ?? 1) + (p?.children ?? 0));
