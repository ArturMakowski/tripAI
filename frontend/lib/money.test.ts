import { describe, expect, it } from "vitest";
import { scoreLocally } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { moneyOf } from "./money";
import { weightsFromSlider } from "./scoring";

const rec = scoreLocally(DEMO_PROFILE, weightsFromSlider(50))[0];

describe("moneyOf: one source for every screen's numbers", () => {
  it("total is exactly flight + hotel (rounded per line)", () => {
    const m = moneyOf({ ...rec, flight_cost_pln: 262.4, hotel_cost_pln: 1180.4, total_cost_pln: 1442.8 });
    expect(m).toMatchObject({ flight: 262, hotel: 1180, partyTotal: 1442, perPerson: 1442, travelers: 1 });
  });
  it("flags a backend total that disagrees with its own lines", () => {
    expect(moneyOf({ ...rec, total_cost_pln: rec.total_cost_pln + 40 }).mismatch).toBe(true);
    expect(moneyOf(rec).mismatch).toBe(false);
  });
  it("'per person' only when every line is per person; a room-priced stay says per room", () => {
    expect(moneyOf(rec).basis).toBe("perPerson");
    const room = { ...rec, evidence: rec.evidence.map((e) => (e.kind === "hotel" ? { ...e, unit: "PLN/room" } : e)) };
    expect(moneyOf(room).basis).toBe("perRoom");
  });
});

describe("party pricing", () => {
  it("2 people share one room: flights × 2 + hotel × 1, then per person", () => {
    const m = moneyOf({ ...rec, travelers: 2 });
    expect(m.partyTotal).toBe(262 * 2 + 1180);
    expect(m.perPerson).toBe(Math.round((262 * 2 + 1180) / 2));
  });
  it("backend party figures win", () => {
    const m = moneyOf({ ...rec, travelers: 2, party_total_pln: 2480, per_person_pln: 1240 });
    expect([m.partyTotal, m.perPerson]).toEqual([2480, 1240]);
  });
});

describe("price status", () => {
  it("a city-average hotel makes the trip 'partial' and marks the hotel leg", () => {
    const partial = { ...rec, evidence: rec.evidence.map((e) => (e.kind === "hotel" ? { ...e, source: "estimate:city-average" } : e)) };
    const m = moneyOf(partial);
    expect(m.status).toBe("partial");
    expect(m.estimated).toEqual({ flight: false, hotel: true });
  });
  it("backend 'estimate' marks every leg", () => {
    expect(moneyOf({ ...rec, price_status: "estimate" }).estimated).toEqual({ flight: true, hotel: true });
  });
});

describe("price honesty in live mode (review #31, BUDGET.md Nice case)", () => {
  // Nice 11–15 Nov: Wizz 22–29 Nov from Travel Explore (358 zł) + an editorial city-average hotel
  // (1 292 zł). The API declared "exact" (its default); the evidence says otherwise.
  const nice = {
    ...rec,
    city: "Nice",
    price_status: "exact",
    flight_cost_pln: 358,
    hotel_cost_pln: 1292,
    total_cost_pln: 1650,
    evidence: rec.evidence.map((e) =>
      e.kind === "flight"
        ? { ...e, value: 358, source: "serpapi:google_travel_explore", label: "Return flight KRK-NCE (Google Travel Explore, not your exact dates)" }
        : e.kind === "hotel"
          ? { ...e, value: 1292, source: "estimate:tripai-editorial", label: "Hotel 4 nights in Nice (city average) x1.0 for standard" }
          : e,
    ),
  };
  it("evidence of other-date prices beats a declared 'exact'", () => {
    const m = moneyOf(nice);
    expect(m.status).toBe("estimate");
    expect(m.estimated).toEqual({ flight: true, hotel: true });
    expect(m.perPerson).toBe(1650);
  });
  it("an Aviasales month median marks just the flight leg", () => {
    const median = {
      ...rec,
      price_status: "exact",
      evidence: rec.evidence.map((e) =>
        e.kind === "flight"
          ? { ...e, source: "travelpayouts", label: "Return flight (median of 7 Aviasales cached fares, not your exact dates)" }
          : e,
      ),
    };
    const m = moneyOf(median);
    expect(m.status).toBe("partial");
    expect(m.estimated).toEqual({ flight: true, hotel: false });
  });
  it("a declared 'estimate' is never upgraded by clean-looking evidence", () => {
    expect(moneyOf({ ...rec, price_status: "estimate" }).status).toBe("estimate");
  });
});
