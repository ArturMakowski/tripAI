import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
    configurable: true,
  });
});
import { renderToStaticMarkup } from "react-dom/server";
import { SourceTag } from "@/components/source-tag";
import { MESSAGES } from "@/lib/i18n";
import { useTrip } from "@/lib/store";

const at = "2026-10-03T07:42:00Z";
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("estimated price legs say what kind of estimate they are, keeping source + date", () => {
  // Server rendering reads the store's initial state (EN); the PL wording is pinned from the dictionary below.
  it.each([["en", "Google Travel Explore · fare seen for different dates", "TripAI · city average, not a specific hotel"]] as const)("%s", (lang, flight, hotel) => {
    useTrip.setState({ lang });
    const f = text(renderToStaticMarkup(
      <SourceTag variant="chip" e={{ kind: "flight", source: "serpapi:google_travel_explore", label: "Return flight (Google Travel Explore, not your exact dates)", fetched_at: at, url: null }} />,
    ));
    const h = text(renderToStaticMarkup(
      <SourceTag variant="chip" e={{ kind: "hotel", source: "estimate:tripai-editorial", label: "Hotel 4 nights (city average)", fetched_at: at, url: null }} />,
    ));
    expect(f.startsWith(flight), f).toBe(true);
    expect(h.startsWith(hotel)).toBe(true);
    expect(f).toMatch(/· 3/); // the fetch date stays
    // an exact leg is just its source
    const ok = text(renderToStaticMarkup(
      <SourceTag variant="chip" e={{ kind: "flight", source: "serpapi:google_flights", label: "Return flight", fetched_at: at, url: null }} />,
    ));
    expect(ok.startsWith("Google Flights · 3")).toBe(true);
  });
  it("PL wording (user request)", () => {
    const m = MESSAGES.pl.money;
    expect([m.fareOtherDates, m.cityAverageHotel, m.noLivePrice]).toEqual([
      "cena z innych terminów",
      "średnia dla miasta, nie konkretny hotel",
      "Brak jeszcze ceny na dokładnie te daty",
    ]);
    expect(m.fromEstimate("1 973 zł")).toBe("~1 973 zł · szacunek");
    expect(m.fromEstimateParty("2 258 zł", "1 129 zł")).toBe("~2 258 zł razem · ~1 129 zł/os. · szacunek");
    expect(MESSAGES.en.money.fromEstimate("1,973 PLN")).toBe("~1,973 PLN · estimate");
  });
});
