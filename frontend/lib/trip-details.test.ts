import { describe, expect, it } from "vitest";
import { fastEstimates, scoreLocally } from "./mock/api";
import { buildRecommendations, DEMO_PROFILE } from "./mock/fixtures";
import { haversineKm } from "./mock/trip-details";
import { DEFAULT_WEIGHTS } from "./scoring";
import {
  airlinesOf,
  appleDirectionsUrl,
  arrivesNextDay,
  derivedSource,
  flightLine,
  formatDuration,
  googleMapsUrl,
  hotelLine,
  hotelPlaceQuery,
  journeyMin,
  layoverMin,
  mapPins,
  trustedDetails,
} from "./trip-details";
import { en, pl } from "./i18n/messages/tripDetails";
import type { FlightDetails, FlightLeg, HotelDetails } from "./types";

const leg = (o: Partial<FlightLeg> = {}): FlightLeg => ({
  airline: "Ryanair",
  flight_number: "FR 3506",
  from_iata: "KRK",
  to_iata: "FCO",
  depart_at: "2027-01-14T06:25:00",
  arrive_at: "2027-01-14T08:30:00",
  duration_min: 125,
  ...o,
});

const back = (o: Partial<FlightLeg> = {}) =>
  leg({ flight_number: "FR 3507", from_iata: "FCO", to_iata: "KRK", depart_at: "2027-01-19T09:00:00", arrive_at: "2027-01-19T11:05:00", ...o });

const flight = (o: Partial<FlightDetails> = {}): FlightDetails => ({
  outbound: [leg()],
  inbound: [back()],
  stops_outbound: 0,
  stops_inbound: 0,
  price_pln: 262,
  booking_url: null,
  source: "serpapi:google_flights",
  fetched_at: "2026-10-03T09:42:00Z",
  ...o,
});

const hotel = (o: Partial<HotelDetails> = {}): HotelDetails => ({
  name: "Hotel X",
  address: null,
  location: null,
  rating: 4.4,
  reviews: null,
  stars: null,
  price_pln_total: null,
  distance_to_center_km: 1.2,
  airport: null,
  city_center: null,
  transfers: [],
  booking_url: null,
  photo_url: null,
  source: "serpapi:google_hotels",
  fetched_at: "2026-10-03T09:42:00Z",
  ...o,
});

describe("formatting", () => {
  it("formats durations like the cards", () => {
    expect(formatDuration(125)).toBe("2 h 05");
    expect(formatDuration(60)).toBe("1 h 00");
    expect(formatDuration(45)).toBe("45 min");
  });

  it("builds the compact flight line in PL and EN, for the whole return trip", () => {
    expect(flightLine(flight(), pl)).toBe("Ryanair · bezpośrednio w obie strony · 2 h 05");
    expect(flightLine(flight(), en)).toBe("Ryanair · direct both ways · 2 h 05");
  });

  it("never describes a return trip from the outbound leg alone (review #3)", () => {
    const mixed = flight({
      inbound: [back({ airline: "LOT", to_iata: "WAW", duration_min: 125 }), back({ airline: "LOT", from_iata: "WAW", duration_min: 55 })],
      stops_inbound: 1,
    });
    expect(flightLine(mixed, en)).toBe("Ryanair + LOT · there direct, back 1 stop");
    expect(flightLine(mixed, pl)).toBe("Ryanair + LOT · tam bezpośredni, powrót 1 przesiadka");
    expect(flightLine(flight({ stops_outbound: 1, stops_inbound: 1, outbound: [leg(), leg()], inbound: [back(), back()] }), en)).toBe(
      "Ryanair · 1 stop each way",
    );
    // the way back is unknown: airline only
    expect(flightLine(flight({ inbound: [], stops_inbound: null }), en)).toBe("Ryanair");
    expect(flightLine(flight({ inbound: [back({ duration_min: 130 })] }), en)).toBe("Ryanair · direct both ways · 2 h 05 / 2 h 10");
  });

  it("uses Polish plural forms for reviews", () => {
    expect(pl.reviews(1, "1")).toBe("1 opinia");
    expect(pl.reviews(3, "3")).toBe("3 opinie");
    expect(pl.reviews(1864, "1 864")).toBe("1 864 opinie");
    expect(pl.reviews(1865, "1 865")).toBe("1 865 opinii");
    expect(en.reviews(1, "1")).toBe("1 review");
  });

  it("uses Polish plural forms for stops", () => {
    expect(pl.stops(1)).toBe("1 przesiadka");
    expect(pl.stops(2)).toBe("2 przesiadki");
    expect(pl.stops(5)).toBe("5 przesiadek");
    expect(en.stops(2)).toBe("2 stops");
  });

  it("builds the compact hotel line with the locale's decimal separator", () => {
    expect(hotelLine(hotel(), pl)).toBe("Hotel X ★4,4 · 1,2 km od centrum");
    expect(hotelLine(hotel(), en)).toBe("Hotel X ★4.4 · 1.2 km from centre");
  });
});

describe("null fields hide, never guessed", () => {
  it("drops unknown stops and duration from the flight line", () => {
    const fast = flight({ outbound: [leg({ flight_number: null, depart_at: null, arrive_at: null, duration_min: null })], stops_outbound: null });
    expect(flightLine(fast, en)).toBe("Ryanair");
  });

  it("has no line without a flight or airline", () => {
    expect(flightLine(null, en)).toBeNull();
    expect(flightLine(flight({ outbound: [], inbound: [] }), en)).toBeNull();
    expect(hotelLine(undefined, en)).toBeNull();
  });

  it("drops rating and distance from the hotel line when unknown", () => {
    expect(hotelLine(hotel({ rating: null, distance_to_center_km: null }), en)).toBe("Hotel X");
  });

  it("gives no door-to-door duration for a connection (local times are in different zones)", () => {
    expect(journeyMin([leg(), leg({ from_iata: "FCO", to_iata: "OPO" })])).toBeNull();
    expect(
      flightLine(flight({ outbound: [leg({ airline: "LOT" }), leg({ airline: "TAP" })], stops_outbound: 1, inbound: [back({ airline: "TAP" })] }), en),
    ).toBe("LOT + TAP · there 1 stop, back direct");
  });

  it("computes a layover only from times at the same airport", () => {
    const a = leg({ arrive_at: "2027-01-14T09:10:00" });
    const b = leg({ depart_at: "2027-01-14T10:30:00" });
    expect(layoverMin(a, b)).toBe(80);
    expect(layoverMin(leg({ arrive_at: null }), b)).toBeNull();
  });

  it("flags next-day arrivals", () => {
    expect(arrivesNextDay(leg({ depart_at: "2027-01-19T18:35:00", arrive_at: "2027-01-20T01:20:00" }))).toBe(true);
    expect(arrivesNextDay(leg())).toBe(false);
  });

  it("places only pins that have coordinates", () => {
    expect(mapPins(hotel(), en)).toEqual([]);
    const pins = mapPins(hotel({ location: { lat: 1, lon: 2, label: null }, city_center: { lat: 1.1, lon: 2.1, label: null } }), en);
    expect(pins.map((p) => p.kind)).toEqual(["hotel", "centre"]);
    expect(pins[1].name).toBe(en.pinCentre);
  });
});

describe("sources and links", () => {
  it("keeps sample data labelled as sample data when deriving a source", () => {
    expect(derivedSource("fixture:serpapi:google_hotels", "estimate:haversine")).toBe("fixture:estimate:haversine");
    expect(derivedSource("serpapi:google_hotels", "estimate:haversine")).toBe("estimate:haversine");
  });

  it("builds Google and Apple Maps links: coordinates or name + address, never mixed (review #5)", () => {
    const p = { lat: 41.8897, lon: 12.4703, label: null };
    expect(googleMapsUrl(p)).toBe("https://www.google.com/maps/search/?api=1&query=41.889700%2C12.470300");
    const q = hotelPlaceQuery(hotel({ address: "Vicolo del Piede 7, 00153 Roma" }));
    expect(q).toBe("Hotel X, Vicolo del Piede 7, 00153 Roma");
    expect(googleMapsUrl(p, q)).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q!)}`);
    expect(googleMapsUrl(p, hotelPlaceQuery(hotel()))).toBe("https://www.google.com/maps/search/?api=1&query=41.889700%2C12.470300");
    expect(appleDirectionsUrl({ lat: 1, lon: 2, label: null }, { lat: 3, lon: 4, label: null })).toBe(
      "https://maps.apple.com/?saddr=1.000000,2.000000&daddr=3.000000,4.000000&dirflg=r",
    );
  });

  it("lists airlines once", () => {
    expect(airlinesOf([leg(), leg()])).toBe("Ryanair");
    expect(airlinesOf([])).toBeNull();
  });
});

describe("only details of the priced trip are shown (review #2, docs/BUDGET.md)", () => {
  const window = { start: "2027-01-14", end: "2027-01-19", source: "gcal" };
  const rec = { flight: flight(), hotel: hotel(), window };

  it("shows everything for an exact price (or a backend that predates price_status)", () => {
    expect(trustedDetails(rec)).toEqual({ flight: rec.flight, hotel: rec.hotel });
    expect(trustedDetails({ ...rec, price_status: "exact" }).hotel).toBe(rec.hotel);
  });

  it("never shows a hotel for a partial or estimated price", () => {
    expect(trustedDetails({ ...rec, price_status: "estimate" }).hotel).toBeNull();
    expect(trustedDetails({ ...rec, price_status: "partial" }).hotel).toBeNull();
  });

  it("keeps the itinerary only when its dates are the trip's dates", () => {
    expect(trustedDetails({ ...rec, price_status: "partial" }).flight).toBe(rec.flight);
    const otherDates = flight({ outbound: [leg({ depart_at: "2027-01-22T06:25:00" })] });
    const shown = trustedDetails({ ...rec, flight: otherDates, price_status: "estimate" }).flight!;
    expect(flightLine(shown, en)).toBe("Ryanair");
    expect(shown.outbound[0].depart_at).toBeNull();
    expect(shown.price_pln).toBeNull();
    expect(shown.booking_url).toBeNull();
  });
});

describe("mock trip details match the priced trip", () => {
  const recs = buildRecommendations();

  it("shows the itinerary and stay that were priced", () => {
    for (const r of recs) {
      expect(r.flight?.price_pln).toBe(r.flight_cost_pln);
      expect(r.hotel?.price_pln_total).toBe(r.hotel_cost_pln);
      expect(r.flight?.outbound[0].depart_at?.slice(0, 10)).toBe(r.window.start);
      expect(r.flight?.inbound[0].depart_at?.slice(0, 10)).toBe(r.window.end);
      expect(r.flight?.stops_outbound).toBe((r.flight?.outbound.length ?? 1) - 1);
      expect(r.flight?.source.startsWith("fixture:")).toBe(true);
      expect(r.hotel?.source.startsWith("fixture:")).toBe(true);
    }
  });

  it("names the same airline as the flight evidence", () => {
    for (const r of recs) {
      const ev = r.evidence.find((e) => e.kind === "flight")!;
      expect(ev.label).toContain(r.flight!.outbound[0].airline);
    }
  });

  it("computes distance to centre by haversine from the shown coordinates", () => {
    for (const r of recs) {
      const h = r.hotel!;
      expect(h.distance_to_center_km).toBe(Math.round(haversineKm(h.location!, h.city_center!) * 10) / 10);
      expect(h.distance_to_center_km!).toBeLessThan(3);
    }
  });

  it("never invents public transport where Google gave none (Venice: OSRM drive only)", () => {
    const vce = recs.find((r) => r.iata === "VCE")!;
    expect(vce.hotel!.transfers.map((t) => [t.mode, t.source])).toEqual([["drive", "fixture:osrm"]]);
  });

  it("fast phase knows the airline only and no hotel", () => {
    const fast = fastEstimates(scoreLocally(DEMO_PROFILE, DEFAULT_WEIGHTS));
    for (const r of fast) {
      expect(r.hotel).toBeNull();
      expect(r.flight?.outbound[0].depart_at).toBeNull();
      expect(r.flight?.stops_outbound).toBeNull();
      expect(flightLine(r.flight, en)).toBe(r.flight!.outbound[0].airline);
      expect(trustedDetails(r).hotel).toBeNull();
    }
  });
});
