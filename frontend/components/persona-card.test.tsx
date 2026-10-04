// T19: the Travel DNA persona as a compact card on /trips (title + one line, expand, hide).
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
import { PersonaCardView, personaSummary } from "@/components/persona-card";
import { DNA_DECK, collectAnswers, type DnaSwipe } from "@/lib/dna";
import { SLIDER_PRESETS } from "@/lib/scoring";
import { useTrip } from "@/lib/store";

// a foodie who cares about price: "So me!" on the food + price cards, "Depends" elsewhere
const foodie: DnaSwipe[] = DNA_DECK.map((c) =>
  c.kind === "yesno" ? { id: c.id, value: true } : { id: c.id, value: /food|price|cheap|budget/i.test(c.short.en) ? 5 : 3 },
);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("personaSummary", () => {
  it("gives the persona, how the list is ranked (current weights) and the swipes behind it", () => {
    const p = personaSummary(collectAnswers(foodie), SLIDER_PRESETS[0].weights, "en");
    expect(p.title).toMatch(/^The /);
    expect(p.line).toBe("Price matters most, then the weather.");
    expect(p.why).toMatch(/^Because you swiped “So me!” on /);
  });

  it("follows the slider: the line changes with the weights", () => {
    const a = personaSummary(collectAnswers(foodie), SLIDER_PRESETS[0].weights, "pl").line;
    const b = personaSummary(collectAnswers(foodie), SLIDER_PRESETS[2].weights, "pl").line;
    expect(a).not.toBe(b);
  });
});

describe("PersonaCardView", () => {
  beforeEach(() => void (lang.current = "pl"));

  it("is compact: persona title + one line, collapsed, with expand and hide", () => {
    const html = renderToStaticMarkup(<PersonaCardView swipes={foodie} />);
    const p = personaSummary(collectAnswers(foodie), useTrip.getState().weights, "pl");
    expect(text(html)).toBe(`${p.title} ${p.line} Skąd to?`); // the last part is screen-reader only
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('title="Skąd to?"');
    expect(html).toContain('aria-label="Ukryj"');
    // the swipes and the link to the full view only after expanding
    expect(html).not.toContain("/profile#dna");
  });

  it("speaks English and never shows a percentage", () => {
    lang.current = "en";
    const html = renderToStaticMarkup(<PersonaCardView swipes={foodie} />);
    expect(html).toContain('aria-label="Your travel DNA"');
    expect(html).toContain('aria-label="Hide"');
    expect(text(html)).not.toMatch(/\d\s?%/);
  });
});
