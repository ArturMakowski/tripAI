// The returning-user home summary (T16): #1 trip with the card's honesty labels, next time off, counts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
});
// renderToStaticMarkup reads zustand's initial state (no lang), so pin the language here
const lang = vi.hoisted(() => ({ current: "pl" as "pl" | "en" }));
vi.mock("@/lib/i18n", async (orig) => {
  const m = await orig<typeof import("@/lib/i18n")>();
  return { ...m, useT: () => ({ t: m.MESSAGES[lang.current], fmt: m.fmtFor(lang.current), lang: lang.current }) };
});
import { renderToStaticMarkup } from "react-dom/server";
import { TodaySummary } from "@/components/home-today";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { scoreLocally, withPriceStatus } from "@/lib/mock/api";
import { freeWindows } from "@/lib/home-today";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";

const recs = withPriceStatus(scoreLocally(DEMO_PROFILE, DEFAULT_WEIGHTS));
const top = recs[0];
const NOW = Date.parse("2026-10-04T12:00:00Z");
const free = freeWindows([], [], "2026-10-04");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const render = (props: Partial<Parameters<typeof TodaySummary>[0]> = {}) =>
  renderToStaticMarkup(<TodaySummary top={top} checkedAt={NOW - 2 * 3600_000} free={free} watched={0} unread={0} now={NOW} {...props} />);

describe("TodaySummary", () => {
  beforeEach(() => void (lang.current = "pl"));

  it("previews the #1 trip and links to its trip page", () => {
    const html = render();
    expect(html).toContain(`href="/trips/${top.id}"`);
    expect(text(html)).toContain("Twój nr 1 teraz");
    expect(text(html)).toContain(top.city);
    expect(text(html)).toMatch(/\d+ (noc|noce|nocy)/);
    expect(text(html)).toContain("sprawdzone 2 godz. temu");
  });

  it("labels an estimated price like the card does", () => {
    // Venice is the demo's estimate (priced from other dates)
    const venice = recs.find((r) => r.price_status === "estimate")!;
    const t = text(render({ top: venice }));
    expect(t).toMatch(/~[\d\s\u00a0]+zł · szacunek/);
    // and the same total as the card's data-amount
    const html = render({ top: venice });
    expect(html).toContain('data-testid="trip-total"');
    // never styled like an exact price
    expect(html).toMatch(/data-testid="trip-total"[^>]*class="[^"]*italic[^"]*text-muted-foreground/);
  });

  it("shows the next long weekend from PL holidays", () => {
    const t = text(render({ top: null }));
    expect(t).toContain("Najbliższe wolne");
    expect(t).toContain("11–15 lis · Święto Niepodległości");
    expect(t).toContain("Weź 2 dni urlopu → 5 dni");
  });

  it("links watched trips and unread notifications only when there are some", () => {
    expect(render()).not.toContain('href="/my-trips"');
    const html = render({ watched: 2, unread: 3 });
    expect(html).toContain('href="/my-trips"');
    expect(html).toContain('href="/inbox"');
    expect(text(html)).toContain("3 nowe");
  });

  it("renders nothing when nothing is stored", () => {
    expect(render({ top: null, free: [] })).toBe("");
  });

  it("speaks English and never shows a percentage", () => {
    lang.current = "en";
    const t = text(render({ watched: 1, unread: 5 }));
    expect(t).toContain("Your #1 right now");
    expect(t).toContain("Independence Day");
    expect(t).toContain("Take 2 days off → 5 days");
    expect(t).toContain("5 new");
    expect(t).not.toMatch(/\d\s?%/);
  });
});
