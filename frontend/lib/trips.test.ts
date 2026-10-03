import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { pl } from "./i18n/pl";
import { PAST_TRIP } from "./mock/fixtures";
import { headlinePrice, localTrips, parseTarget, priceLine, surveyHref, surveyTrip, targetReached, withItem } from "./trips";
import type { TripItem } from "./types";

const base: TripItem = {
  id: "FCO-20270114-20270118",
  kind: "approved",
  city: "Rome",
  country: "Italy",
  iata: "FCO",
  start: "2027-01-14",
  end: "2027-01-18",
  travelers: 2,
  saved_pln: 1200,
  saved_price_status: "exact",
  saved_at: "2026-10-03T08:00:00Z",
  watched: true,
  current_pln: null,
  price_status: null,
  checked_at: null,
  change_pln: null,
  target_pln: null,
};
const checked = (p: Partial<TripItem>): TripItem => ({ ...base, checked_at: "2026-10-04T05:00:00Z", ...p });

describe("price line", () => {
  it("down / up / same since saved, from the backend's exact-date difference", () => {
    expect(priceLine(checked({ current_pln: 1080, price_status: "exact", change_pln: -120 }))).toEqual({ kind: "down", amount: 120 });
    expect(priceLine(checked({ current_pln: 1280, price_status: "exact", change_pln: 80 }))).toEqual({ kind: "up", amount: 80 });
    expect(priceLine(checked({ current_pln: 1200, price_status: "exact", change_pln: 0.2 }))).toEqual({ kind: "same" });
  });

  it("an estimate is shown muted and never compared, and the headline stays the saved price", () => {
    const est = checked({ current_pln: 700, price_status: "estimate", change_pln: null });
    expect(priceLine(est)).toEqual({ kind: "estimate", amount: 700 });
    expect(headlinePrice(est)).toBe(1200);
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

describe("target price", () => {
  it("reached only on an exact-date price at or under the target", () => {
    const t = checked({ current_pln: 1000, price_status: "exact", change_pln: -200, target_pln: 1000 });
    expect(targetReached(t)).toBe(true);
    expect(targetReached({ ...t, target_pln: 999 })).toBe(false);
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
    total_cost_pln: 1200,
  };

  it("approved cards are planned, the demo trip is past, unknown ids are skipped", () => {
    const out = localTrips([base.id, "NOPE-1-2"], [rec], { [base.id]: 950 }, "2026-10-03");
    expect(out.planned.map((t) => [t.id, t.saved_pln, t.target_pln, t.watched])).toEqual([[base.id, 1200, 950, false]]);
    expect(out.past.map((t) => t.id)).toEqual([PAST_TRIP.id]);
  });

  it("an approved trip moves to past after its end date", () => {
    const out = localTrips([base.id], [rec], {}, "2027-02-01");
    expect(out.planned).toEqual([]);
    expect(out.past.map((t) => t.id)).toEqual([base.id, PAST_TRIP.id]);
  });
});
