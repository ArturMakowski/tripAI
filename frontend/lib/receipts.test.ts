import { describe, expect, it } from "vitest";
import { handoffLinks, originOf } from "./handoff";
import { scoreLocally } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { weightsFromSlider } from "./scoring";
import { sameWeights } from "./use-recommendations";

const rec = scoreLocally(DEMO_PROFILE, weightsFromSlider(50))[0];
// label-based cases: no itinerary attached (the itinerary's first leg wins when there is one)
const fromWaw = {
  ...rec,
  flight: null,
  evidence: rec.evidence.map((e) => (e.kind === "flight" ? { ...e, label: "Return WAW-MLA 01.01-03.01" } : e)),
};

describe("hand-off uses the priced origin", () => {
  it("reads the origin from flight evidence", () => {
    expect(originOf(rec)).toBe("KRK");
    expect(originOf(fromWaw)).toBe("WAW");
  });
  it("prefers the itinerary's departure airport and reads a city group's first airport", () => {
    const leg = { airline: "Ryanair", flight_number: null, from_iata: "WMI", to_iata: "MLA", depart_at: null, arrive_at: null, duration_min: null };
    const flight = { outbound: [leg], inbound: [], stops_outbound: 0, stops_inbound: null } as unknown as NonNullable<typeof rec.flight>;
    expect(originOf({ ...fromWaw, flight })).toBe("WMI");
    const group = { ...rec, flight: null, evidence: rec.evidence.map((e) => (e.kind === "flight" ? { ...e, label: "Typical return WAW/WMI-MLA in Jan" } : e)) };
    expect(originOf(group)).toBe("WAW");
  });
  it("falls back to the profile airport when evidence has none", () => {
    expect(originOf({ ...rec, flight: null, evidence: [] }, "KTW")).toBe("KTW");
  });
  it("puts the origin into the Google Flights link", () => {
    expect(decodeURIComponent(handoffLinks(fromWaw)[0].url)).toContain("Flights from WAW to");
  });
});

describe("hand-off never links a fare for other dates (card polish)", () => {
  const trip = { ...rec, window: { ...rec.window, start: "2026-11-07", end: "2026-11-11" }, iata: "NCE", city: "Nice", travelers: 2 };
  const otherDates = {
    ...trip,
    evidence: trip.evidence.map((e) =>
      e.kind === "flight"
        ? { ...e, label: "Return KRK-NCE dep 15 Nov, back 22 Nov, Wizz direct (Aviasales cached fare, not bookable)", url: "https://partner.example/fare-15-22-nov", source: "travelpayouts:grouped_prices" }
        : e.kind === "hotel"
          ? { ...e, label: "Hotel 4 nights in Nice (city average)", url: "https://partner.example/city-average", source: "estimate:tripai-editorial" }
          : e,
    ),
  };
  it("an estimated flight links a search for the trip's own dates, never the other-dates fare", () => {
    const links = handoffLinks(otherDates, "KRK", { flights: "F", hotels: "H", checkPrices: "Sprawdź ceny na te daty" });
    const urls = links.map((l) => l.url);
    expect(urls.some((u) => u.includes("fare-15-22-nov") || u.includes("city-average"))).toBe(false);
    const check = links.find((l) => l.label === "Sprawdź ceny na te daty")!;
    expect(check.url).toBe("https://www.aviasales.com/search/KRK0711NCE11112"); // 7 Nov -> 11 Nov, 2 adults
    expect(links.find((l) => l.label === "H")!.url).toContain("checkin=2026-11-07&checkout=2026-11-11&group_adults=2");
  });
  it("an exact-date fare keeps its own link, and no extra search is added", () => {
    const exact = {
      ...trip,
      evidence: trip.evidence.map((e) => (e.kind === "flight" ? { ...e, label: "Return KRK-NCE 7-11 Nov · Ryanair", url: "https://partner.example/fare-7-11-nov", source: "serpapi:google_flights" } : e)),
    };
    const links = handoffLinks(exact, "KRK", { flights: "F", hotels: "H", checkPrices: "C" });
    expect(links.map((l) => l.url)).toContain("https://partner.example/fare-7-11-nov");
    expect(links.some((l) => l.label === "C")).toBe(false);
  });
});

describe("receipt freshness", () => {
  it("compares weights after normalisation", () => {
    expect(sameWeights({ price: 2, weather: 1, crowds: 1, taste: 0 }, { price: 0.5, weather: 0.25, crowds: 0.25, taste: 0 })).toBe(true);
    expect(sameWeights(weightsFromSlider(0), weightsFromSlider(50))).toBe(false);
    expect(sameWeights(null, weightsFromSlider(50))).toBe(false);
  });
  it("fixture flip hints always point at the current neighbour", () => {
    for (const pos of [0, 50, 100]) {
      const ranked = scoreLocally(DEMO_PROFILE, weightsFromSlider(pos));
      expect(ranked[0].flip?.rival_id).toBe(ranked[1].id);
      ranked.slice(1).forEach((r, i) => expect(r.flip?.rival_id).toBe(ranked[i].id));
    }
  });
});
