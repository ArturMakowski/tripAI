/**
 * Sample "which flight / which hotel" details (docs/TRIP_DETAILS.md) for the demo fixtures, shaped exactly like
 * the backend's FlightDetails / HotelDetails. Airports and city centres are real coordinates; hotels are fictional
 * names on real streets. Every source is "fixture:*", so the UI labels it "TripAI sample data".
 * Prices match the fixture's flight_cost_pln / hotel_cost_pln (the shown itinerary is the one that was priced).
 */
import type { FlightDetails, FlightLeg, FreeWindow, GeoPoint, HotelDetails, TransferOption } from "../types";

const FETCHED = "2026-10-03T09:42:00Z";

/** [airline, flight number, from, to, depart HH:MM, arrive HH:MM, minutes, day offset of arrival] */
type LegSeed = [string, string, string, string, string, string, number, number?];

interface DetailSeed {
  outbound: LegSeed[];
  inbound: LegSeed[];
  airport: GeoPoint;
  center: GeoPoint;
  hotel: Omit<HotelDetails, "price_pln_total" | "distance_to_center_km" | "airport" | "city_center" | "transfers" | "source" | "fetched_at" | "booking_url" | "photo_url">;
  /** Google Hotels transfer rows; null = Google gave none, so only an OSRM driving estimate exists. */
  transfers: Omit<TransferOption, "source" | "fetched_at">[] | null;
  drive: { duration_min: number; distance_km: number };
}

const DETAILS: Record<string, DetailSeed> = {
  FCO: {
    outbound: [["Ryanair", "FR 3506", "KRK", "FCO", "06:25", "08:30", 125]],
    inbound: [["Ryanair", "FR 3507", "FCO", "KRK", "09:00", "11:05", 125]],
    airport: { lat: 41.8003, lon: 12.2389, label: "Roma Fiumicino (FCO)" },
    center: { lat: 41.896, lon: 12.4823, label: "Piazza Venezia" },
    hotel: {
      name: "Casa Trastevere Suites",
      address: "Vicolo del Piede 7, 00153 Roma",
      location: { lat: 41.8897, lon: 12.4703, label: "Casa Trastevere Suites" },
      rating: 4.6,
      reviews: 1864,
      stars: 3,
    },
    transfers: [
      { mode: "train", duration_min: 32, distance_km: 27, price_pln: 34, note: "FL1 regional train to Roma Trastevere, then 12 min walk" },
      { mode: "taxi", duration_min: 45, distance_km: 29, price_pln: 236, note: "Fixed fare into the city walls" },
    ],
    drive: { duration_min: 38, distance_km: 29.4 },
  },
  LIS: {
    outbound: [["Wizz Air", "W6 1351", "KRK", "LIS", "14:40", "17:45", 245]],
    inbound: [["Wizz Air", "W6 1352", "LIS", "KRK", "18:35", "01:20", 225, 1]],
    airport: { lat: 38.7742, lon: -9.1342, label: "Lisboa Humberto Delgado (LIS)" },
    center: { lat: 38.7075, lon: -9.1364, label: "Praça do Comércio" },
    hotel: {
      name: "Alfama Patio Rooms",
      address: "Rua de São Miguel 41, 1100-544 Lisboa",
      location: { lat: 38.7116, lon: -9.1295, label: "Alfama Patio Rooms" },
      rating: 4.4,
      reviews: 932,
      stars: null, // guesthouse without an official class
    },
    transfers: [
      { mode: "public_transport", duration_min: 35, distance_km: 9, price_pln: 8, note: "Metro red → green line to Santa Apolónia, 1 change" },
      { mode: "taxi", duration_min: 20, distance_km: 9, price_pln: 64, note: null },
    ],
    drive: { duration_min: 17, distance_km: 9.3 },
  },
  ATH: {
    outbound: [["Ryanair", "FR 6123", "KRK", "ATH", "10:15", "13:35", 140]],
    inbound: [["Ryanair", "FR 6124", "ATH", "KRK", "14:10", "15:35", 145]],
    airport: { lat: 37.9364, lon: 23.9445, label: "Athens Eleftherios Venizelos (ATH)" },
    center: { lat: 37.9755, lon: 23.7348, label: "Syntagma Square" },
    hotel: {
      name: "Plaka Stone House",
      address: "Kydathineon 18, Athina 105 58",
      location: { lat: 37.9713, lon: 23.7309, label: "Plaka Stone House" },
      rating: 4.7,
      reviews: 611,
      stars: 3,
    },
    transfers: [
      { mode: "public_transport", duration_min: 42, distance_km: 33, price_pln: 39, note: "Metro line 3 to Syntagma, then 7 min walk" },
      { mode: "bus", duration_min: 60, distance_km: 35, price_pln: 24, note: "X95 express bus to Syntagma" },
      { mode: "taxi", duration_min: 35, distance_km: 34, price_pln: 171, note: "Flat daytime fare" },
    ],
    drive: { duration_min: 33, distance_km: 33.8 },
  },
  VCE: {
    // Ryanair flies Kraków–Treviso: the airport pin is TSF, not Marco Polo.
    outbound: [["Ryanair", "FR 1814", "KRK", "TSF", "17:50", "19:30", 100]],
    inbound: [["Ryanair", "FR 1815", "TSF", "KRK", "19:55", "21:35", 100]],
    airport: { lat: 45.6484, lon: 12.1944, label: "Treviso Canova (TSF)" },
    center: { lat: 45.4341, lon: 12.3388, label: "Piazza San Marco" },
    hotel: {
      name: "Cannaregio Canal Inn",
      address: "Fondamenta della Misericordia 2560, 30121 Venezia",
      location: { lat: 45.4447, lon: 12.3316, label: "Cannaregio Canal Inn" },
      rating: 4.3,
      reviews: 1207,
      stars: null,
    },
    transfers: null, // no transfer info from Google: OSRM driving estimate only, never invented public transport
    drive: { duration_min: 41, distance_km: 37.6 },
  },
  OPO: {
    outbound: [
      ["TAP Air Portugal", "TP 1271", "KRK", "LIS", "06:05", "09:10", 245],
      ["TAP Air Portugal", "TP 1944", "LIS", "OPO", "10:30", "11:25", 55],
    ],
    inbound: [
      ["TAP Air Portugal", "TP 1951", "OPO", "LIS", "12:15", "13:10", 55],
      ["TAP Air Portugal", "TP 1270", "LIS", "KRK", "14:25", "21:05", 220],
    ],
    airport: { lat: 41.2481, lon: -8.6814, label: "Porto Francisco Sá Carneiro (OPO)" },
    center: { lat: 41.1456, lon: -8.6109, label: "Avenida dos Aliados" },
    hotel: {
      name: "Ribeira Riverside Guesthouse",
      address: "Rua da Fonte Taurina 52, 4050-262 Porto",
      location: { lat: 41.1409, lon: -8.6123, label: "Ribeira Riverside Guesthouse" },
      rating: 4.5,
      reviews: 408,
      stars: 2,
    },
    transfers: [
      { mode: "public_transport", duration_min: 35, distance_km: 17, price_pln: 9, note: "Metro line E to Trindade, then line D to São Bento" },
      { mode: "taxi", duration_min: 25, distance_km: 18, price_pln: 107, note: null },
    ],
    drive: { duration_min: 22, distance_km: 17.9 },
  },
};

/** Great-circle km, as the backend computes distance_to_center_km (source estimate:haversine). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function legs(seeds: LegSeed[], day: string): FlightLeg[] {
  return seeds.map(([airline, flight_number, from_iata, to_iata, dep, arr, duration_min, plus = 0]) => ({
    airline,
    flight_number,
    from_iata,
    to_iata,
    depart_at: `${day}T${dep}:00`,
    arrive_at: `${addDays(day, plus)}T${arr}:00`,
    duration_min,
  }));
}

const googleFlightsUrl = (from: string, to: string, w: Pick<FreeWindow, "start" | "end">) =>
  `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to} on ${w.start} returning ${w.end}`)}`;

/** Full-phase flight: exact itinerary behind `price` (Google Flights shape). */
export function sampleFlight(iata: string, window: Pick<FreeWindow, "start" | "end">, price: number): FlightDetails | null {
  const d = DETAILS[iata];
  if (!d) return null;
  return {
    outbound: legs(d.outbound, window.start),
    inbound: legs(d.inbound, window.end),
    stops_outbound: d.outbound.length - 1,
    stops_inbound: d.inbound.length - 1,
    price_pln: price,
    booking_url: googleFlightsUrl(d.outbound[0][2], d.outbound.at(-1)![3], window),
    source: "fixture:serpapi:google_flights",
    fetched_at: FETCHED,
  };
}

/** Fast-phase flight: Travelpayouts only knows the airline, so everything else is null (never guessed). */
export function sampleFastFlight(iata: string): FlightDetails | null {
  const d = DETAILS[iata];
  if (!d) return null;
  const [airline, , from] = d.outbound[0];
  return {
    outbound: [{ airline, flight_number: null, from_iata: from, to_iata: d.outbound.at(-1)![3], depart_at: null, arrive_at: null, duration_min: null }],
    inbound: [],
    stops_outbound: null,
    stops_inbound: null,
    price_pln: null,
    booking_url: null,
    source: "fixture:travelpayouts-calendar",
    fetched_at: FETCHED,
  };
}

export function sampleHotel(iata: string, city: string, priceTotal: number): HotelDetails | null {
  const d = DETAILS[iata];
  if (!d) return null;
  const transfers: TransferOption[] = d.transfers
    ? d.transfers.map((t) => ({ ...t, source: "fixture:serpapi:google_hotels", fetched_at: FETCHED }))
    : [{ mode: "drive", ...d.drive, price_pln: null, note: null, source: "fixture:osrm", fetched_at: FETCHED }];
  return {
    ...d.hotel,
    price_pln_total: priceTotal,
    distance_to_center_km: d.hotel.location ? Math.round(haversineKm(d.hotel.location, d.center) * 10) / 10 : null,
    airport: d.airport,
    city_center: d.center,
    transfers,
    booking_url: `https://www.google.com/travel/hotels/${encodeURIComponent(city)}?q=${encodeURIComponent(d.hotel.name)}`,
    photo_url: null,
    source: "fixture:serpapi:google_hotels",
    fetched_at: FETCHED,
  };
}
