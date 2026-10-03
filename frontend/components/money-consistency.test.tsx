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
import { MoneyLines, PriceInline, TripPrice } from "@/components/money";
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
  // the hero line ("14–19 sty · 5 nocy · 1 442 zł") and the money lines
  receipt: renderToStaticMarkup(
    <>
      <PriceInline rec={rec} tone="light" />
      <MoneyLines rec={rec} nights="4" />
    </>,
  ),
  confirm: renderToStaticMarkup(
    <>
      <TripPrice rec={rec} tone="light" showParty={false} />
      <MoneyLines rec={rec} nights="4" flightLabel="KRK → FCO" />
    </>,
  ),
});

function recs(people: number, fast: boolean) {
  const profile = { ...DEMO_PROFILE, adults: people, children: 0, rooms: null };
  const full = withParty(withPriceStatus(scoreLocally(profile, DEFAULT_WEIGHTS)), profile);
  return fast ? withParty(fastEstimates(full), profile) : full;
}

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
      expect(receipt, rec.id).toHaveLength(2);
      expect(confirm.length, rec.id).toBeGreaterThanOrEqual(1);
      const want = card[0];
      for (const got of [...receipt, ...confirm]) expect(got[0], `${rec.id} amount`).toBe(want[0]);
      // same visible number (the estimate is phrased "od ~X zł (inne daty)" everywhere it appears)
      const num = (t: string) => t.replace(/&nbsp;|\u00a0|\u202f/g, " ").match(/[\d\s.,]+(?=\s?(zł|PLN))/)?.[0].trim();
      // an estimate reads "od ~X" / "from ~X" on every screen, never as a bare price
      if (rec.price_status === "estimate") for (const got of [card[0], ...receipt, ...confirm]) expect(got[1], rec.id).toMatch(/~/);
      for (const got of [...receipt, ...confirm]) expect(num(got[1]), `${rec.id} text`).toBe(num(want[1]));
      // and the per-person number is what the party pays divided by its size
      expect(Number(want[0])).toBe(Math.round(rec.party_total_pln! / rec.travelers!));
    }
  });
});
