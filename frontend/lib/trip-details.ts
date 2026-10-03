/**
 * Pure helpers for "which flight, which hotel, where, how to get there" (docs/TRIP_DETAILS.md).
 * Everything shown comes from the backend's FlightDetails / HotelDetails: a null field is hidden, never guessed.
 * The only arithmetic is on values that share a time zone (a layover: arrival and next departure at the same airport).
 */
import type { FlightDetails, FlightLeg, GeoPoint, HotelDetails, Recommendation } from "./types";
import type { Messages } from "./i18n/en";

export type TripDetailsStrings = Messages["tripDetails"];

/** 125 -> "2 h 05", 45 -> "45 min". */
export function formatDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** "2027-01-14T06:25:00" -> "06:25": local time at that airport, never converted. */
export const clock = (iso: string) => iso.slice(11, 16);

/** "Thu 14 Jan" / "czw., 14 sty" from the local date part. */
export function legDay(iso: string, locale: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Arrival on a later local date than departure (+1). */
export function arrivesNextDay(leg: FlightLeg): boolean {
  return !!leg.depart_at && !!leg.arrive_at && leg.arrive_at.slice(0, 10) > leg.depart_at.slice(0, 10);
}

/** Minutes between landing and the next take-off; both are local times at the same airport. */
export function layoverMin(arriving: FlightLeg, departing: FlightLeg): number | null {
  if (!arriving.arrive_at || !departing.depart_at) return null;
  const min = (Date.parse(`${departing.depart_at}Z`) - Date.parse(`${arriving.arrive_at}Z`)) / 60_000;
  return Number.isFinite(min) && min >= 0 ? min : null;
}

/** Door-to-door duration of one direction. Only a direct flight has one that needs no time-zone guess. */
export function journeyMin(legs: FlightLeg[]): number | null {
  return legs.length === 1 ? legs[0].duration_min : null;
}

/** "Ryanair", or "LOT + Lufthansa" for a mixed itinerary. */
export function airlinesOf(legs: FlightLeg[]): string | null {
  const names = [...new Set(legs.map((l) => l.airline).filter(Boolean))];
  return names.length ? names.join(" + ") : null;
}

export function stopsLabel(n: number, t: TripDetailsStrings): string {
  return n === 0 ? t.direct : t.stops(n);
}

/** Stops for the whole return trip: "direct both ways", "1 stop each way", or "there direct, back 1 stop". */
export function returnStopsLabel(flight: FlightDetails, t: TripDetailsStrings): string | null {
  const out = flight.stops_outbound;
  if (out == null) return null;
  if (flight.inbound.length === 0) return null; // the way back is unknown: never describe a return trip from one leg
  const back = flight.stops_inbound;
  if (back == null) return null;
  if (out === back) return out === 0 ? t.directBoth : t.stopsEach(out);
  return t.stopsSplit(stopsLabel(out, t), stopsLabel(back, t));
}

/** Compact card line: "Ryanair · direct both ways · 2 h 05". Covers both directions; unknown parts are dropped. */
export function flightLine(flight: FlightDetails | null | undefined, t: TripDetailsStrings): string | null {
  if (!flight) return null;
  const airline = airlinesOf([...flight.outbound, ...flight.inbound]);
  if (!airline) return null;
  const parts = [airline];
  const stops = returnStopsLabel(flight, t);
  if (stops) parts.push(stops);
  const there = journeyMin(flight.outbound);
  const back = flight.inbound.length ? journeyMin(flight.inbound) : null;
  if (there != null && back != null) parts.push(there === back ? formatDuration(there) : `${formatDuration(there)} / ${formatDuration(back)}`);
  return parts.join(" · ");
}

/** A direction's first departure falls on the expected date (the trip's start or end). */
const departsOn = (legs: FlightLeg[], day: string) => legs[0]?.depart_at?.slice(0, 10) === day;

/**
 * Only details that belong to THIS trip's priced dates (docs/BUDGET.md "Hotel shown = hotel priced", price honesty):
 * - hotel: only when the whole price is exact (a city-average estimate is never shown as a hotel);
 * - flight: full itinerary when exact, or when its departure dates match the window; otherwise the airline only.
 */
export function trustedDetails(rec: Pick<Recommendation, "price_status" | "flight" | "hotel" | "window">): {
  flight: FlightDetails | null;
  hotel: HotelDetails | null;
} {
  const exact = (rec.price_status ?? "exact") === "exact";
  const f = rec.flight ?? null;
  let flight = f;
  if (f && !exact) {
    const datesMatch = departsOn(f.outbound, rec.window.start) && (f.inbound.length === 0 || departsOn(f.inbound, rec.window.end));
    if (!datesMatch) {
      const airline = f.outbound[0];
      flight = {
        ...f,
        outbound: airline ? [{ ...airline, flight_number: null, depart_at: null, arrive_at: null, duration_min: null, to_iata: f.outbound.at(-1)!.to_iata }] : [],
        inbound: [],
        stops_outbound: null,
        stops_inbound: null,
        price_pln: null,
        booking_url: null,
      };
    }
  }
  return { flight, hotel: exact ? (rec.hotel ?? null) : null };
}

export function formatKm(km: number, locale: string): string {
  return km.toLocaleString(locale, { minimumFractionDigits: km < 10 ? 1 : 0, maximumFractionDigits: km < 10 ? 1 : 0 });
}

export function formatRating(r: number, locale: string): string {
  return r.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Card line in two parts, so a long name truncates and the numbers never do: ["Hotel X", "★4.4 · 1.2 km from centre"]. */
export function hotelLineParts(hotel: HotelDetails | null | undefined, t: TripDetailsStrings): [string, string] | null {
  if (!hotel?.name) return null;
  const facts: string[] = [];
  if (hotel.rating != null) facts.push(`★${formatRating(hotel.rating, t.locale)}`);
  if (hotel.distance_to_center_km != null) facts.push(t.fromCentre(formatKm(hotel.distance_to_center_km, t.locale)));
  return [hotel.name, facts.join(" · ")];
}

/** Compact card line: "Hotel X ★4.4 · 1.2 km from centre". */
export function hotelLine(hotel: HotelDetails | null | undefined, t: TripDetailsStrings): string | null {
  const parts = hotelLineParts(hotel, t);
  if (!parts) return null;
  return [parts[0], parts[1]].filter(Boolean).join(hotel?.rating != null ? " " : " · ");
}

/**
 * A source derived from another one (e.g. the straight-line distance computed from the hotel's coordinates).
 * Sample data stays labelled as sample data.
 */
export function derivedSource(base: string, derived: string): string {
  return base.startsWith("fixture:") ? `fixture:${derived}` : derived;
}

// --- maps ------------------------------------------------------------------------------

const ll = (p: GeoPoint) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/** Google's `query` is free text: either "name, address" (finds the place card) or bare coordinates (an exact pin), never mixed. */
export function googleMapsUrl(p: GeoPoint, place?: string | null): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place || ll(p))}`;
}

/** "Casa Trastevere Suites, Vicolo del Piede 7, 00153 Roma" when the address is known, else null (use coordinates). */
export const hotelPlaceQuery = (hotel: Pick<HotelDetails, "name" | "address">) => (hotel.address ? `${hotel.name}, ${hotel.address}` : null);

export function appleMapsUrl(p: GeoPoint, query?: string | null): string {
  return `https://maps.apple.com/?ll=${ll(p)}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
}

export function googleDirectionsUrl(from: GeoPoint, to: GeoPoint): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=transit`;
}

export function appleDirectionsUrl(from: GeoPoint, to: GeoPoint): string {
  return `https://maps.apple.com/?saddr=${ll(from)}&daddr=${ll(to)}&dirflg=r`;
}

export type PinKind = "hotel" | "airport" | "centre";
export interface MapPin {
  kind: PinKind;
  point: GeoPoint;
  name: string;
  /** Google Maps place query; null = search by coordinates. */
  query: string | null;
}

/** Pins we can actually place: only points with coordinates from the backend. */
export function mapPins(hotel: HotelDetails, t: TripDetailsStrings): MapPin[] {
  const pins: MapPin[] = [];
  if (hotel.location) pins.push({ kind: "hotel", point: hotel.location, name: hotel.name, query: hotelPlaceQuery(hotel) });
  if (hotel.airport) pins.push({ kind: "airport", point: hotel.airport, name: hotel.airport.label ?? t.pinAirport, query: null });
  if (hotel.city_center) pins.push({ kind: "centre", point: hotel.city_center, name: hotel.city_center.label ?? t.pinCentre, query: null });
  return pins;
}
