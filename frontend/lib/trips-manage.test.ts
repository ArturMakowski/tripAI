/** T24 "manage my trips": the pure logic behind delete + undo, edit dates/party, booked. */
import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { pl } from "./i18n/pl";
import { editChips, editError, editPatch, isPast, MAX_TRIP_NIGHTS, placeItem, removeItem, restoreItem, shiftRange, tripActions } from "./trips";
import type { TripItem, TripsResponse } from "./types";

const trip = (id: string, start: string, end: string, extra: Partial<TripItem> = {}): TripItem => ({
  id,
  kind: "approved",
  city: id.slice(0, 3),
  country: "",
  iata: id.slice(0, 3),
  start,
  end,
  travelers: 1,
  saved_pln: 900,
  saved_flight_pln: 400,
  saved_hotel_pln: 500,
  saved_party_pln: 900,
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
  status: "planned",
  rateable: false,
  ...extra,
});

const NAP = trip("NAP-20261107-20261111", "2026-11-07", "2026-11-11");
const ATH = trip("ATH-20261111-20261115", "2026-11-11", "2026-11-15");
const LIS = trip("LIS-20270101-20270103", "2027-01-01", "2027-01-03");
const BCN = trip("BCN-20260812-20260817", "2026-08-12", "2026-08-17", { rateable: true });
const list = (): TripsResponse => ({ planned: [NAP, ATH, LIS], past: [BCN], max_watched: 5 });
const TODAY = "2026-10-04"; // a Sunday

describe("delete + undo", () => {
  it("the row leaves at once and comes back exactly where it was", () => {
    const { list: after, removed } = removeItem(list(), ATH.id);
    expect(after.planned.map((t) => t.id)).toEqual([NAP.id, LIS.id]);
    expect(removed).toEqual({ item: ATH, section: "planned", index: 1 });
    expect(restoreItem(after, removed!).planned.map((t) => t.id)).toEqual([NAP.id, ATH.id, LIS.id]);
  });

  it("undo shows the server's restored copy, never a duplicate", () => {
    const { list: after, removed } = removeItem(list(), BCN.id);
    const back = { ...BCN, target_pln: 700 };
    const twice = restoreItem(restoreItem(after, removed!, back), removed!, back);
    expect(twice.past).toEqual([back]);
  });

  it("an unknown id changes nothing", () => {
    const l = list();
    expect(removeItem(l, "nope")).toEqual({ list: l, removed: null });
  });
});

describe("booked and past", () => {
  it("booking moves the trip to Past; un-booking brings it back in date order", () => {
    const booked = { ...ATH, status: "booked" as const, watched: false };
    const l = placeItem(list(), booked);
    expect(l.planned.map((t) => t.id)).toEqual([NAP.id, LIS.id]);
    expect(l.past.map((t) => t.id)).toEqual([ATH.id, BCN.id]); // latest end first
    expect(isPast(booked) && isPast(BCN) && !isPast(NAP)).toBe(true);
    expect(placeItem(l, { ...booked, status: "planned" }).planned.map((t) => t.id)).toEqual([NAP.id, ATH.id, LIS.id]);
  });

  it("an edit with new dates replaces the old id", () => {
    const moved = { ...NAP, id: "NAP-20261121-20261125", start: "2026-11-21", end: "2026-11-25", pending: true };
    expect(placeItem(list(), moved, NAP.id).planned.map((t) => t.id)).toEqual([ATH.id, moved.id, LIS.id]);
  });

  it("the row menu: edit + book for plans, un-book for booked, delete always; demo view: delete only", () => {
    expect(tripActions(NAP, true)).toEqual(["edit", "book", "remove"]);
    expect(tripActions({ status: "booked", rateable: false }, true)).toEqual(["unbook", "remove"]);
    expect(tripActions(BCN, true)).toEqual(["remove"]);
    expect(tripActions(NAP, false)).toEqual(["remove"]);
  });
});

describe("edit dates / party", () => {
  it("validates like the backend", () => {
    const d = { start: NAP.start, end: NAP.end, travelers: 1 };
    expect(editError(NAP, d, TODAY)).toBe("unchanged");
    expect(editError(NAP, { ...d, travelers: 2 }, TODAY)).toBeNull();
    expect(editError(NAP, { ...d, start: "2026-10-01" }, TODAY)).toBe("past");
    expect(editError(NAP, { ...d, end: NAP.start }, TODAY)).toBe("tooShort");
    expect(editError(NAP, { ...d, end: shiftRange({ start: NAP.start, end: NAP.start }, MAX_TRIP_NIGHTS + 1).end }, TODAY)).toBe("tooLong");
  });

  it("sends only what changed", () => {
    expect(editPatch(NAP, { start: NAP.start, end: NAP.end, travelers: 3 })).toEqual({ travelers: 3 });
    expect(editPatch(NAP, { ...shiftRange(NAP, 1), travelers: 1 })).toEqual({ start: "2026-11-08", end: "2026-11-12" });
    expect(editPatch(NAP, { start: NAP.start, end: NAP.end, travelers: 40 })).toEqual({ travelers: 12 });
  });

  it("quick chips: a day earlier/later, this weekend, the next long weekend; never in the past", () => {
    const long = [{ start: "2026-11-07", end: "2026-11-11" }, { start: "2026-12-24", end: "2026-12-27" }];
    const chips = editChips(NAP, TODAY, long);
    expect(chips.map((c) => c.key)).toEqual(["earlier", "later", "weekend"]); // the long weekend IS this trip
    expect(chips[0].range).toEqual({ start: "2026-11-06", end: "2026-11-10" });
    const soon = trip("KRK-20261004-20261006", "2026-10-04", "2026-10-06");
    const soonChips = editChips(soon, TODAY, long);
    expect(soonChips.map((c) => c.key)).toEqual(["later", "weekend", "longWeekend"]); // no "earlier": the past
    expect(soonChips[1].range).toEqual({ start: "2026-10-10", end: "2026-10-11" }); // on a Sunday: next weekend
  });
});

describe("copy", () => {
  it("PL/EN toasts and actions", () => {
    expect(pl.myTrips.deleted("Neapol")).toBe("Usunięto: Neapol");
    expect(pl.myTrips.undo).toBe("Cofnij");
    expect(en.myTrips.deleted("Naples")).toBe("Naples deleted");
    expect(pl.myTrips.remove).toBe("Usuń");
  });

  it("no percent sign anywhere in My trips (docs: numbers people read as money, not ratios)", () => {
    for (const dict of [en.myTrips, pl.myTrips])
      for (const v of Object.values(dict)) {
        const text = typeof v === "function" ? (v as (...a: unknown[]) => string)("Rzym", "2") : v;
        expect(text).not.toContain("%");
      }
  });
});
