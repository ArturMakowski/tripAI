/**
 * T13 "My trips": approved plans + saved picks with their latest price check, the user's target price,
 * and past trips to rate (backend api/trips.py via lib/api.ts). Without the live backend
 * (NEXT_PUBLIC_MOCK=1 or unreachable) the list is built locally from approved cards in the store,
 * with the demo past trip so "Rate trip" still works; nothing is re-priced there.
 */
import { api, FORCE_MOCK, type Result } from "./api";
import { PAST_TRIP } from "./mock/fixtures";
import type { RankedRecommendation, TripItem, TripsResponse } from "./types";

export const DEFAULT_MAX_WATCHED = 5;

/** What the price line under a planned trip says. Estimates are never compared with a saved price. */
export type PriceLine =
  | { kind: "down" | "up"; amount: number }
  | { kind: "exactNow"; amount: number } // exact-date price now, but the saved one was an estimate: no comparison
  | { kind: "same" }
  | { kind: "estimate"; amount: number }
  | { kind: "none" } // checked, but no price for these dates now
  | { kind: "unchecked" };

export function priceLine(t: TripItem): PriceLine {
  if (!t.checked_at) return { kind: "unchecked" };
  if (t.current_pln == null) return { kind: "none" };
  if (t.price_status !== "exact") return { kind: "estimate", amount: t.current_pln };
  if (t.change_pln == null) return { kind: "exactNow", amount: t.current_pln };
  const d = Math.round(t.change_pln);
  if (d === 0) return { kind: "same" };
  return { kind: d < 0 ? "down" : "up", amount: Math.abs(d) };
}

/** The price shown big on the card: the latest exact-date check, else what it cost when saved. */
export function headlinePrice(t: TripItem): number {
  return headline(t).amount;
}

/**
 * Headline price + whether it is an estimate. Price honesty (docs/BUDGET.md): an estimated saved price
 * (other dates / city average) is never shown as a plain number; the card renders it muted, "od ~X zł".
 */
export function headline(t: TripItem): { amount: number; estimate: boolean } {
  if (t.current_pln != null && t.price_status === "exact") return { amount: t.current_pln, estimate: false };
  return { amount: t.saved_pln, estimate: t.saved_price_status !== "exact" };
}

/** Drop a trip from the list (stop watching a saved-only trip). */
export function withoutItem(list: TripsResponse, id: string): TripsResponse {
  return { ...list, planned: list.planned.filter((x) => x.id !== id), past: list.past.filter((x) => x.id !== id) };
}

/** True when the latest exact-date price is at or under the user's target (the scan alerts then). */
export function targetReached(t: TripItem): boolean {
  return t.target_pln != null && t.current_pln != null && t.price_status === "exact" && t.current_pln <= t.target_pln;
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
  recs: Pick<RankedRecommendation, "id" | "city" | "country" | "iata" | "window" | "total_cost_pln" | "travelers" | "price_status">[],
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
      saved_price_status: asStatus(r.price_status),
      saved_at: new Date().toISOString(),
      watched: false,
      current_pln: null,
      price_status: null,
      checked_at: null,
      change_pln: null,
      target_pln: targets[r.id] ?? null,
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
    saved_price_status: "exact",
    saved_at: `${iso(a)}T00:00:00Z`,
    watched: false,
    current_pln: null,
    price_status: null,
    checked_at: null,
    change_pln: null,
    target_pln: null,
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
