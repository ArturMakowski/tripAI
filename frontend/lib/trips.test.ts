import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { pl } from "./i18n/pl";
import { PAST_TRIP } from "./mock/fixtures";
import { headline, headlinePrice, localTrips, parseTarget, priceLine, surveyHref, surveyTrip, targetReached, withItem, withoutItem } from "./trips";
import { moneyOf } from "./money";
import type { TripItem } from "./types";

// docs/BUDGET.md example: Palma, 2 adults, 1 room: flight 428 pp + hotel 964 (whole stay) = 1 820 for the group, 910 pp
const base: TripItem = {
  id: "PMI-20270114-20270118",
  kind: "approved",
  city: "Palma",
  country: "Spain",
  iata: "PMI",
  start: "2027-01-14",
  end: "2027-01-18",
  travelers: 2,
  saved_pln: 910,
  saved_flight_pln: 428,
  saved_hotel_pln: 964,
  saved_party_pln: 1820,
  saved_price_status: "exact",
  saved_at: "2026-10-03T08:00:00Z",
  watched: true,
  current_pln: null,
  current_flight_pln: null,
  current_hotel_pln: null,
  current_party_pln: null,
  current_travelers: null,
  price_status: null,
  checked_at: null,
  change_pln: null,
  target_pln: null,
};
const checked = (p: Partial<TripItem>): TripItem => ({ ...base, checked_at: "2026-10-04T05:00:00Z", ...p });
/** a scan check for the same party: flight 368 pp + hotel 964 = 1 700, 850 pp */
const cheaper = (p: Partial<TripItem> = {}) =>
  checked({ current_pln: 850, current_flight_pln: 368, current_hotel_pln: 964, current_party_pln: 1700, current_travelers: 2, price_status: "exact", change_pln: -60, ...p });

describe("party money (same as the card: moneyOf)", () => {
  it("the headline is per person with the group total: flight × n + the stay", () => {
    const m = moneyOf(headline(base).rec);
    expect([m.flightLine, m.hotelLine, m.partyTotal, m.perPerson, m.travelers]).toEqual([856, 964, 1820, 910, 2]);
    expect(headline(base).estimate).toBe(false);
  });

  it("the latest exact check becomes the headline; the chip is the per-person change", () => {
    const t = cheaper();
    expect(moneyOf(headline(t).rec).partyTotal).toBe(1700);
    expect(headlinePrice(t)).toBe(850);
    expect(priceLine(t)).toEqual({ kind: "down", amount: 60 });
    expect(priceLine(cheaper({ current_flight_pln: 488, current_pln: 970, change_pln: 60 }))).toEqual({ kind: "up", amount: 60 });
    expect(priceLine(cheaper({ current_flight_pln: 428, current_pln: 910, change_pln: 0 }))).toEqual({ kind: "same" });
  });

  it("another party size is not a price change", () => {
    const solo = cheaper({ current_travelers: 1, current_flight_pln: 428, current_hotel_pln: 482, current_pln: 910, change_pln: null });
    expect(priceLine(solo)).toEqual({ kind: "exactNow", amount: 910 });
  });

  it("rows without lines show the per-person figure only (never a guessed split)", () => {
    const old = { ...base, saved_flight_pln: null, saved_hotel_pln: null, saved_party_pln: null };
    const m = moneyOf(headline(old).rec);
    expect([m.perPerson, m.travelers]).toEqual([910, 1]);
  });
});

describe("price line", () => {
  it("an estimate is shown muted and never compared, and the headline stays the saved price", () => {
    const est = cheaper({ current_pln: 700, current_flight_pln: 300, current_hotel_pln: 800, price_status: "estimate", change_pln: null });
    expect(priceLine(est)).toEqual({ kind: "estimate", amount: 700 });
    expect(headlinePrice(est)).toBe(910);
    expect(targetReached({ ...est, target_pln: 900 })).toBe(false);
  });

  it("unchecked and no-price-now states", () => {
    expect(priceLine(base)).toEqual({ kind: "unchecked" });
    expect(priceLine(checked({ current_pln: null }))).toEqual({ kind: "none" });
  });

  it("copy matches the user-testing wording", () => {
    expect(pl.myTrips.down("120 zł")).toBe("↓ 120 zł od zapisania");
    expect(en.myTrips.down("120 PLN")).toBe("↓ 120 PLN since saved");
    expect(pl.myTrips.party(2)).toBe("2 osoby");
    expect(pl.myTrips.party(5)).toBe("5 osób");
    expect(pl.myTrips.rate).toBe("Oceń wyjazd");
  });

  it("DECLUTTER: headline ≤ 6 words, subline ≤ 10", () => {
    for (const m of [en.myTrips, pl.myTrips]) {
      expect(m.title.split(/\s+/).length).toBeLessThanOrEqual(6);
      expect(m.sub.split(/\s+/).length).toBeLessThanOrEqual(10);
    }
  });
});

describe("estimated saved price (review #2)", () => {
  const est: TripItem = { ...base, saved_price_status: "estimate", saved_pln: 650, saved_flight_pln: 300, saved_hotel_pln: 700 };

  it("is never a plain headline number (muted via <PriceInline>)", () => {
    expect(headline(est).estimate).toBe(true);
    expect(headline({ ...cheaper({ price_status: "estimate", change_pln: null }), saved_price_status: "estimate" }).estimate).toBe(true);
    expect(headline(base).estimate).toBe(false);
  });

  it("an exact check later becomes the headline, without a 'since saved' comparison", () => {
    const now: TripItem = { ...cheaper({ change_pln: null }), saved_price_status: "estimate", saved_pln: 650, saved_flight_pln: 300, saved_hotel_pln: 700 };
    expect(headline(now).estimate).toBe(false);
    expect(headlinePrice(now)).toBe(850);
    expect(priceLine(now)).toEqual({ kind: "exactNow", amount: 850 });
  });
});

describe("target price", () => {
  it("reached only on an exact-date price at or under the target", () => {
    const t = cheaper({ target_pln: 850 });
    expect(targetReached(t)).toBe(true);
    expect(targetReached({ ...t, target_pln: 849 })).toBe(false);
    expect(targetReached({ ...t, target_pln: null })).toBe(false);
  });

  it("parses typed amounts", () => {
    expect(parseTarget("1 200")).toBe(1200);
    expect(parseTarget("1,200 zł")).toBe(1200);
    expect(parseTarget("999.6")).toBe(1000);
    expect(parseTarget("0")).toBeNull();
    expect(parseTarget("abc")).toBeNull();
    expect(parseTarget("")).toBeNull();
  });

  it("replaces one item in place", () => {
    const list = { planned: [base], past: [], max_watched: 5 };
    expect(withItem(list, { ...base, target_pln: 900 }).planned[0].target_pln).toBe(900);
    expect(withoutItem(list, base.id).planned).toEqual([]);
  });
});

describe("survey link", () => {
  it("round-trips the trip through the query", () => {
    const href = surveyHref({ id: "LIS-20260801-20260805", city: "Lizbona" });
    const q = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/survey?")).toBe(true);
    expect(surveyTrip(q)).toEqual({ id: "LIS-20260801-20260805", city: "Lizbona", iata: "LIS" });
  });

  it("falls back to the demo past trip on missing or malformed ids", () => {
    expect(surveyTrip(new URLSearchParams()).id).toBe(PAST_TRIP.id);
    expect(surveyTrip(new URLSearchParams({ trip: "../x", city: "X" })).id).toBe(PAST_TRIP.id);
  });
});

describe("fixture view", () => {
  const rec = {
    id: base.id,
    city: "Rome",
    country: "Italy",
    iata: "FCO",
    window: { start: base.start, end: base.end, source: "manual" as const },
    total_cost_pln: 910,
    flight_cost_pln: 428,
    hotel_cost_pln: 964,
    travelers: 2,
  };

  it("approved cards are planned, the demo trip is past, unknown ids are skipped", () => {
    const out = localTrips([base.id, "NOPE-1-2"], [rec], { [base.id]: 950 }, "2026-10-03");
    expect(out.planned.map((t) => [t.id, t.saved_pln, t.saved_party_pln, t.target_pln, t.watched])).toEqual([[base.id, 910, 1820, 950, false]]);
    expect(out.past.map((t) => t.id)).toEqual([PAST_TRIP.id]);
  });

  it("an approved trip moves to past after its end date", () => {
    const out = localTrips([base.id], [rec], {}, "2027-02-01");
    expect(out.planned).toEqual([]);
    expect(out.past.map((t) => t.id)).toEqual([base.id, PAST_TRIP.id]);
  });
});
