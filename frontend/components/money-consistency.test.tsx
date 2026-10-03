// Money consistency (docs/BUDGET.md): the card, the receipt and confirm show the same total for
// the same trip, in both phases (fast estimate → full) and both languages, for solo and party
// trips and for exact / partial / estimate prices.
import { beforeAll, describe, expect, it, vi } from "vitest";

// Node's localStorage stub has no setItem; the persisted store needs a real one before import.
vi.hoisted(() => {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
});
import { renderToStaticMarkup } from "react-dom/server";
import { MoneyLines, TripPrice } from "@/components/money";
import { RecCard } from "@/components/rec-card";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { fastEstimates, scoreLocally, withParty, withPriceStatus } from "@/lib/mock/api";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";
import { useTrip } from "@/lib/store";
import type { RankedRecommendation } from "@/lib/types";

/** Every `data-testid="trip-total"` in the markup: [data-amount, visible text]. */
function totals(html: string): [string, string][] {
  return [...html.matchAll(/<span[^>]*data-testid="trip-total"[^>]*data-amount="(\d+)"[^>]*>(.*?)<\/span>/g)].map((m) => [
    m[1],
    m[2].replace(/<[^>]+>/g, ""),
  ]);
}

const screens = (rec: RankedRecommendation) => ({
  card: renderToStaticMarkup(<RecCard rec={rec} />),
  // the receipt's money lines (round 3: the hero no longer repeats the price)
  receipt: renderToStaticMarkup(<MoneyLines rec={rec} nights="4" collapseSources />),
  confirm: renderToStaticMarkup(
    <>
      <TripPrice rec={rec} tone="light" showParty={false} />
      <MoneyLines rec={rec} nights="4" flightLabel="KRK → FCO" />
    </>,
  ),
});

function recs(people: number, fast: boolean) {
  const profile = { ...DEMO_PROFILE, adults: people, children: 0, rooms: null };
  const base = withPriceStatus(scoreLocally(profile, DEFAULT_WEIGHTS));
  return withParty(fast ? fastEstimates(base) : base, profile);
}

/** Lines on the receipt/confirm add up to the total shown under them (the Palma bug), for 1, 2 and 3 people. */
describe.each(["pl", "en"] as const)("lines sum == total shown (%s)", (lang) => {
  beforeAll(() => useTrip.setState({ lang }));
  it.each([1, 2, 3])("%i traveller(s), every fixture trip incl. partial and estimate", (people) => {
    for (const rec of recs(people, false)) {
      const html = renderToStaticMarkup(<MoneyLines rec={rec} nights="4" />);
      const amt = (re: RegExp) => Number(html.match(re)?.[1]);
      const flight = amt(/data-line="flight" data-amount="(\d+)"/);
      const hotel = amt(/data-line="hotel" data-amount="(\d+)"/);
      const total = people > 1 ? amt(/data-testid="party-total" data-amount="(\d+)"/) : amt(/data-testid="trip-total" data-amount="(\d+)"/);
      expect(flight + hotel, `${rec.id} x${people}: ${flight} + ${hotel} vs ${total}`).toBe(total);
      expect(flight, rec.id).toBe(Math.round(rec.flight_cost_pln) * people);
      expect(hotel, rec.id).toBe(Math.round(rec.hotel_cost_pln));
      // and what is displayed matches the data attributes
      const shown = (html.match(/data-testid="(?:party|trip)-total"[^>]*>([^<]+)</)?.[1] ?? "").replace(/[^\d]/g, "");
      expect(shown, rec.id).toBe(String(total));
    }
  });
  it("a backend whose own totals disagree with its lines (the Palma case) still shows lines == total", () => {
    const [rec] = recs(2, false);
    const palma = { ...rec, flight_cost_pln: 705, hotel_cost_pln: 848, party_total_pln: 3106, per_person_pln: 1553, total_cost_pln: 1553 };
    const html = renderToStaticMarkup(<MoneyLines rec={palma} nights="4" />);
    expect(html).toMatch(/data-line="flight" data-amount="1410"/);
    expect(html).toMatch(/data-line="hotel" data-amount="848"/);
    expect(html).toMatch(/data-testid="party-total" data-amount="2258"/);
    expect(html).toMatch(/data-testid="trip-total" data-amount="1129"/);
  });
});

describe.each(["pl", "en"] as const)("money consistency (%s)", (lang) => {
  beforeAll(() => useTrip.setState({ lang }));

  it.each([
    [1, false],
    [2, false],
    [3, false],
    [1, true],
    [2, true],
  ])("card == receipt == confirm for %i traveller(s), fast phase %s", (people, fast) => {
    const list = recs(people, fast);
    expect(list.some((r) => r.price_status === "estimate")).toBe(true);
    expect(list.some((r) => r.price_status === "partial")).toBe(true);
    for (const rec of list) {
      const s = screens(rec);
      const card = totals(s.card);
      const receipt = totals(s.receipt);
      const confirm = totals(s.confirm);
      expect(card, rec.id).toHaveLength(1);
      expect(receipt, rec.id).toHaveLength(1);
      expect(confirm.length, rec.id).toBeGreaterThanOrEqual(1);
      const want = card[0];
      for (const got of [...receipt, ...confirm]) expect(got[0], `${rec.id} amount`).toBe(want[0]);
      // same visible number (the estimate is phrased "od ~X zł (inne daty)" everywhere it appears)
      const num = (t: string) => t.replace(/&nbsp;|\u00a0|\u202f/g, " ").match(/[\d\s.,]+(?=\s?(zł|PLN))/)?.[0].trim();
      // an estimate reads "od ~X" / "from ~X" on every screen, never as a bare price
      if (rec.price_status === "estimate") {
        for (const got of [card[0], ...receipt, ...confirm]) expect(got[1], rec.id).toMatch(/~/);
        // and says "other dates" in words on every screen, not only in a tooltip (review #41)
        for (const html of [s.card, s.receipt, s.confirm]) expect(html, rec.id).toMatch(/inne daty|other dates/);
      }
      // the visible text shows that same per-person number (party headlines read "1 704 zł razem · 852 zł/os.")
      const digits = (t: string) => t.replace(/[^\d]/g, " ").split(/\s+/).join("");
      const perDigits = String(Number(want[0]));
      for (const got of [card[0], ...receipt, ...confirm]) expect(digits(got[1]), `${rec.id} text: ${got[1]}`).toContain(perDigits);
      // and the per-person number is what the party pays divided by its size
      expect(Number(want[0])).toBe(Math.round(rec.party_total_pln! / rec.travelers!));
      void num;
    }
  });
});
