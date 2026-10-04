/**
 * T13 "My trips": approved plans + saved picks with their latest price check, the user's target price,
 * and past trips to rate (backend api/trips.py via lib/api.ts). Without the live backend
 * (NEXT_PUBLIC_MOCK=1 or unreachable) the list is built locally from approved cards in the store,
 * with the demo past trip so "Rate trip" still works; nothing is re-priced there.
 */
import { api, FORCE_MOCK, type Result } from "./api";
import { PAST_TRIP } from "./mock/fixtures";
import { moneyOf } from "./money";
import { addDays, diffDays, thisWeekend, type DateRange } from "./date-range";
import type { RankedRecommendation, Recommendation, TripItem, TripPatch, TripsResponse } from "./types";

export const DEFAULT_MAX_WATCHED = 5;

/** What the price line under a planned trip says. Estimates are never compared with a saved price. */
export type PriceLine =
  | { kind: "down" | "up"; amount: number }
  | { kind: "exactNow"; amount: number } // exact-date price now, but no like-for-like saved price: no comparison
  | { kind: "same" }
  | { kind: "estimate"; amount: number }
  | { kind: "none" } // checked, but no price for these dates now
  | { kind: "unchecked" };

/** A trip's saved or current price in the card's shape, so moneyOf() renders it exactly like the card. */
export type TripPriced = Pick<Recommendation, "flight_cost_pln" | "hotel_cost_pln" | "total_cost_pln" | "evidence" | "travelers" | "party_total_pln" | "per_person_pln" | "price_status">;

function priced(perPerson: number, flight: number | null, hotel: number | null, travelers: number, status: string | null): TripPriced {
  // rows saved before the lines were recorded: the per-person figure only (never a guessed split)
  const lines = flight != null && hotel != null;
  const n = lines ? travelers : 1;
  return {
    flight_cost_pln: lines ? flight : perPerson,
    hotel_cost_pln: lines ? hotel : 0,
    total_cost_pln: perPerson,
    evidence: [],
    travelers: n,
    party_total_pln: null,
    per_person_pln: null,
    price_status: status ?? "exact",
  };
}

export const savedPriced = (t: TripItem): TripPriced =>
  priced(t.saved_pln, t.saved_flight_pln, t.saved_hotel_pln, t.travelers, t.saved_price_status);

export const currentPriced = (t: TripItem): TripPriced | null =>
  t.current_pln == null ? null : priced(t.current_pln, t.current_flight_pln, t.current_hotel_pln, t.current_travelers ?? t.travelers, t.price_status);

/**
 * The headline: the latest exact-date check, else what it cost when saved. Rendered through moneyOf() (party
 * semantics: per person, plus "2 480 zł razem" for a group). An estimate (docs/BUDGET.md price honesty) is
 * never a plain number: <PriceInline> renders it muted, "~X zł · szacunek".
 */
export function headline(t: TripItem): { rec: TripPriced; estimate: boolean } {
  const cur = currentPriced(t);
  const rec = cur && t.price_status === "exact" ? cur : savedPriced(t);
  return { rec, estimate: moneyOf(rec).status === "estimate" };
}

/** The per-person headline amount (placeholder for the target editor). */
export function headlinePrice(t: TripItem): number {
  return moneyOf(headline(t).rec).perPerson;
}

export function priceLine(t: TripItem): PriceLine {
  if (!t.checked_at) return { kind: "unchecked" };
  const cur = currentPriced(t);
  if (cur == null) return { kind: "none" };
  const now = moneyOf(cur).perPerson;
  if (t.price_status !== "exact") return { kind: "estimate", amount: now };
  if (t.change_pln == null) return { kind: "exactNow", amount: now }; // saved as an estimate, or another party size
  // same per-person rounding as the card on both sides (moneyOf), so the chip matches what was shown
  const d = now - moneyOf(savedPriced(t)).perPerson;
  if (d === 0) return { kind: "same" };
  return { kind: d < 0 ? "down" : "up", amount: Math.abs(d) };
}

/** True when the latest exact-date price is at or under the user's target (the scan alerts then). */
export function targetReached(t: TripItem): boolean {
  return t.target_pln != null && t.current_pln != null && t.price_status === "exact" && t.current_pln <= t.target_pln;
}

/** Drop a trip from the list (stop watching a saved-only trip). */
export function withoutItem(list: TripsResponse, id: string): TripsResponse {
  return { ...list, planned: list.planned.filter((x) => x.id !== id), past: list.past.filter((x) => x.id !== id) };
}

/** Parse a typed target ("1 200", "1200 zł", "1,200") to whole PLN; null = invalid. */
export function parseTarget(raw: string): number | null {
  const n = Number(raw.replace(/[\s  ]|zł|pln|,/gi, ""));
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? Math.round(n) : null;
}

/** "Rate trip" opens the existing survey for this trip. */
export function surveyHref(t: Pick<TripItem, "id" | "city">): string {
  return `/survey?${new URLSearchParams({ trip: t.id, city: t.city })}`;
}

/** The survey's trip: from the query (My trips → Past) or the demo past trip. */
export function surveyTrip(params: { get(k: string): string | null }): { id: string; city: string; iata: string } {
  const id = params.get("trip");
  const city = params.get("city");
  if (id && city && /^[A-Z]{3}-\d{8}-\d{8}$/.test(id)) return { id, city, iata: id.slice(0, 3) };
  return { id: PAST_TRIP.id, city: PAST_TRIP.city, iata: PAST_TRIP.id.slice(0, 3) };
}

const asStatus = (s: string | undefined): TripItem["saved_price_status"] => (s === "partial" || s === "estimate" ? s : "exact");

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Fixture view: approved cards from the store (no price checks), plus the demo past trip. */
export function localTrips(
  approved: string[],
  recs: Pick<RankedRecommendation, "id" | "city" | "country" | "iata" | "window" | "total_cost_pln" | "flight_cost_pln" | "hotel_cost_pln" | "travelers" | "price_status">[],
  targets: Record<string, number>,
  today: string = isoDay(new Date()),
): TripsResponse {
  const items: TripItem[] = [];
  for (const id of approved) {
    const r = recs.find((x) => x.id === id);
    if (!r) continue;
    items.push({
      id: r.id,
      kind: "approved",
      city: r.city,
      country: r.country,
      iata: r.iata,
      start: r.window.start,
      end: r.window.end,
      travelers: r.travelers ?? 1,
      saved_pln: r.total_cost_pln,
      saved_flight_pln: r.flight_cost_pln,
      saved_hotel_pln: r.hotel_cost_pln,
      saved_party_pln: r.flight_cost_pln * (r.travelers ?? 1) + r.hotel_cost_pln,
      saved_price_status: asStatus(r.price_status),
      saved_at: new Date().toISOString(),
      watched: false,
      current_pln: null,
      current_flight_pln: null,
      current_hotel_pln: null,
      current_party_pln: null,
      current_travelers: null,
      price_status: null,
      checked_at: null,
      change_pln: null,
      target_pln: targets[r.id] ?? null,
      status: "planned",
      rateable: r.window.end < today,
    });
  }
  const [, a, b] = PAST_TRIP.id.split("-");
  const iso = (x: string) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
  const demoPast: TripItem = {
    id: PAST_TRIP.id,
    kind: "approved",
    city: PAST_TRIP.city,
    country: PAST_TRIP.country,
    iata: PAST_TRIP.id.slice(0, 3),
    start: iso(a),
    end: iso(b),
    travelers: 1,
    saved_pln: 0,
    saved_flight_pln: null,
    saved_hotel_pln: null,
    saved_party_pln: null,
    saved_price_status: "exact",
    saved_at: `${iso(a)}T00:00:00Z`,
    watched: false,
    current_pln: null,
    current_flight_pln: null,
    current_hotel_pln: null,
    current_party_pln: null,
    current_travelers: null,
    price_status: null,
    checked_at: null,
    change_pln: null,
    target_pln: null,
    status: "planned",
    rateable: iso(b) < today,
  };
  const planned = items.filter((t) => t.end >= today).sort((x, y) => x.start.localeCompare(y.start));
  const past = [...items.filter((t) => t.end < today), ...(demoPast.end < today ? [demoPast] : [])].sort((x, y) => y.end.localeCompare(x.end));
  return { planned, past, max_watched: DEFAULT_MAX_WATCHED };
}

/** Live list, else the local fixture view (the page says "Demo data" then). */
export async function loadTrips(local: () => TripsResponse): Promise<Result<TripsResponse>> {
  if (FORCE_MOCK) return { data: local(), mode: "fixture" };
  try {
    return { data: await api.trips(), mode: "live" };
  } catch (err) {
    console.warn("[tripai] /trips unavailable, showing local trips:", err);
    return { data: local(), mode: "fixture" };
  }
}

/** Replace one trip in the list after a target change. */
export function withItem(list: TripsResponse, item: TripItem): TripsResponse {
  const swap = (xs: TripItem[]) => xs.map((x) => (x.id === item.id ? item : x));
  return { ...list, planned: swap(list.planned), past: swap(list.past) };
}

// ------------------------------------------------------------------ T24: manage a trip

/** How long the "Usunięto · Cofnij" toast offers undo (the delete is soft on the server either way). */
export const UNDO_MS = 6_000;
export const MAX_TRIP_NIGHTS = 30; // backend api/trips.py
export const MAX_PARTY = 12;

/** Booked trips and trips that have ended live under "Past". */
export const isPast = (t: TripItem) => t.status === "booked" || !!t.rateable;

const byStart = (x: TripItem, y: TripItem) => x.start.localeCompare(y.start) || x.city.localeCompare(y.city);
const byEndDesc = (x: TripItem, y: TripItem) => y.end.localeCompare(x.end) || x.city.localeCompare(y.city);

/** Put an edited / booked / restored trip in its section, replacing `oldId` (new dates = a new id). */
export function placeItem(list: TripsResponse, item: TripItem, oldId: string = item.id): TripsResponse {
  const drop = (xs: TripItem[]) => xs.filter((x) => x.id !== oldId && x.id !== item.id);
  const planned = drop(list.planned);
  const past = drop(list.past);
  if (isPast(item)) past.push(item);
  else planned.push(item);
  return { ...list, planned: planned.sort(byStart), past: past.sort(byEndDesc) };
}

export interface Removed {
  item: TripItem;
  section: "planned" | "past";
  index: number;
}

/** Optimistic delete: the row leaves at once; `removed` puts it back exactly where it was on undo. */
export function removeItem(list: TripsResponse, id: string): { list: TripsResponse; removed: Removed | null } {
  for (const section of ["planned", "past"] as const) {
    const index = list[section].findIndex((x) => x.id === id);
    if (index >= 0) {
      const xs = [...list[section]];
      const [item] = xs.splice(index, 1);
      return { list: { ...list, [section]: xs }, removed: { item, section, index } };
    }
  }
  return { list, removed: null };
}

export function restoreItem(list: TripsResponse, r: Removed, item: TripItem = r.item): TripsResponse {
  const xs = list[r.section].filter((x) => x.id !== item.id);
  xs.splice(Math.min(r.index, xs.length), 0, item);
  return { ...list, [r.section]: xs };
}

export interface EditDraft {
  start: string;
  end: string;
  travelers: number;
}

export type EditError = "past" | "tooShort" | "tooLong" | "unchanged";

const nights = (d: Pick<EditDraft, "start" | "end">) => diffDays(d.start, d.end);

/** Same rules as PATCH /trips/{id}: starts today or later, 1–30 nights, 1–12 people, something changed. */
export function editError(trip: Pick<TripItem, "start" | "end" | "travelers">, d: EditDraft, today: string): EditError | null {
  if (d.start === trip.start && d.end === trip.end && d.travelers === trip.travelers) return "unchanged";
  if (d.start < today) return "past";
  if (nights(d) < 1) return "tooShort";
  if (nights(d) > MAX_TRIP_NIGHTS) return "tooLong";
  return null;
}

/** Only what changed (the backend re-prices only for a real change). */
export function editPatch(trip: Pick<TripItem, "start" | "end" | "travelers">, d: EditDraft): TripPatch {
  const out: TripPatch = {};
  if (d.start !== trip.start) out.start = d.start;
  if (d.end !== trip.end) out.end = d.end;
  if (d.travelers !== trip.travelers) out.travelers = Math.max(1, Math.min(MAX_PARTY, d.travelers));
  return out;
}

export const shiftRange = (r: Pick<EditDraft, "start" | "end">, days: number) => ({ start: addDays(r.start, days), end: addDays(r.end, days) });

export type EditChipKey = "earlier" | "later" | "weekend" | "longWeekend";

/**
 * Quick chips in the edit sheet: the same trip a day earlier / later, this (or next) weekend, and the next
 * long weekend. Chips that would start in the past or change nothing are left out.
 */
export function editChips(
  trip: Pick<TripItem, "start" | "end">,
  today: string,
  suggestions: Pick<DateRange, "start" | "end">[],
): { key: EditChipKey; range: { start: string; end: string } }[] {
  const weekend = thisWeekend(today);
  const long = suggestions.find((x) => x.start >= today);
  const all: { key: EditChipKey; range: { start: string; end: string } }[] = [
    { key: "earlier", range: shiftRange(trip, -1) },
    { key: "later", range: shiftRange(trip, 1) },
    { key: "weekend", range: { start: weekend.start, end: weekend.end } },
    ...(long ? [{ key: "longWeekend" as const, range: { start: long.start, end: long.end } }] : []),
  ];
  return all.filter((c) => c.range.start >= today && nights(c.range) >= 1 && !(c.range.start === trip.start && c.range.end === trip.end));
}

export type TripAction = "edit" | "book" | "unbook" | "remove";

/**
 * The row menu for a trip. Editing and booking need the live service (they re-price / persist), so the
 * demo view offers only delete. A booked trip can be un-booked until it ends; an ended trip can only go.
 */
export function tripActions(t: Pick<TripItem, "status" | "rateable">, live: boolean): TripAction[] {
  const booked = t.status === "booked";
  const out: TripAction[] = [];
  if (live && !t.rateable) out.push(...(booked ? (["unbook"] as const) : (["edit", "book"] as const)));
  out.push("remove");
  return out;
}
