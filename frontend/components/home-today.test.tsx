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
import { MESSAGES } from "@/lib/i18n";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { scoreLocally, withPriceStatus } from "@/lib/mock/api";
import { nextFreeWindow } from "@/lib/home-today";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";

const recs = withPriceStatus(scoreLocally(DEMO_PROFILE, DEFAULT_WEIGHTS));
const top = recs[0];
const free = nextFreeWindow([], [], "2026-10-04");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
// words = tokens with letters; figures ("14–19", "1 442") don't count (DECLUTTER: numbers before sentences)
const words = (s: string) => s.replace(/<[^>]+>/g, " ").split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

const render = (props: Partial<Parameters<typeof TodaySummary>[0]> = {}) => renderToStaticMarkup(<TodaySummary top={top} free={free} {...props} />);

describe("TodaySummary", () => {
  beforeEach(() => void (lang.current = "pl"));

  it("previews the #1 trip and links to its trip page", () => {
    const html = render();
    expect(html).toContain(`href="/trips/${top.id}"`);
    expect(text(html)).toContain(`Twój nr 1 · 14–19 sty ${top.city}`);
  });

  it("labels an estimated price like the card does, muted", () => {
    // Venice is the demo's estimate (priced from other dates)
    const venice = recs.find((r) => r.price_status === "estimate")!;
    const html = render({ top: venice });
    expect(text(html)).toMatch(/~[\d\s\u00a0]+zł · szacunek/);
    expect(html).toMatch(/data-testid="trip-total"[^>]*class="[^"]*italic[^"]*text-muted-foreground/);
    expect(html).not.toMatch(/data-testid="trip-total"[^>]*class="[^"]*text-ink[" ]/);
  });

  it("shows the next long weekend from PL holidays, holiday name read out", () => {
    const html = render({ top: null });
    expect(text(html)).toBe("11–15 lis Weź 2 dni urlopu → 5 dni");
    expect(html).toContain('aria-label="11–15 lis, Święto Niepodległości, Weź 2 dni urlopu → 5 dni"');
  });

  it("shows the user's own dates when they come first", () => {
    const t = text(render({ top: null, free: nextFreeWindow([{ start: "2026-10-20", end: "2026-10-25" }], [], "2026-10-04") }));
    expect(t).toBe("20–25 paź Twoje terminy · 6 dni");
  });

  it("stays within the declutter budget: few words, two text styles per card", () => {
    // ≤ 25 words above the fold with the headline + lead (the returning view has no promise chips)
    for (const l of ["pl", "en"] as const) {
      lang.current = l;
      const h = MESSAGES[l].home;
      const head = `${h.title} ${Object.values(h.lead).join("")}`;
      expect(words(head) + words(render()), l).toBeLessThanOrEqual(25);
    }
    for (const block of render().match(/<a [\s\S]*?<\/a>/g)!) {
      const styles = new Set([...block.matchAll(/<p class="([^"]*)"/g)].map((m) => m[1].match(/text-\[13px\]|text-lg/)?.[0]));
      expect(styles.size).toBeLessThanOrEqual(2);
    }
  });

  it("renders nothing when nothing is stored", () => {
    expect(render({ top: null, free: null })).toBe("");
  });

  it("speaks English and never shows a percentage", () => {
    lang.current = "en";
    const t = text(render());
    expect(t).toContain("Your #1 · 14–19 Jan");
    expect(t).toContain("Take 2 days off → 5 days");
    expect(t).not.toMatch(/\d\s?%/);
  });
});
