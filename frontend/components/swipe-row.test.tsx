import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
    configurable: true,
  });
});
import { renderToStaticMarkup } from "react-dom/server";
import { RecCard } from "@/components/rec-card";
import { RowActions, SwipeRow } from "@/components/trips-swipe";
import { buildRecommendations } from "@/lib/mock/fixtures";

const [rec] = buildRecommendations();

describe("a swipeable row keeps every action reachable without swiping", () => {
  it("renders the card with its link, the heart and '⋯', and the reveal behind it", () => {
    const html = renderToStaticMarkup(
      <SwipeRow rec={rec} onReact={() => {}} tour="swipe-row">
        <RecCard rec={rec} actions={<RowActions rec={rec} onReact={() => {}} />} />
      </SwipeRow>,
    );
    expect(html).toContain(`href="/trips/${rec.id}"`); // a tap still opens the trip
    expect(html).toMatch(/aria-label="Love it!"[^>]*aria-pressed="false"/);
    expect(html).toContain(`aria-label="More actions for ${rec.city}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-tour="swipe-row"');
    expect(html).toContain("touch-action:pan-y"); // vertical scrolling stays with the page
    expect(html).toContain("I want to go"); // the green reveal
    expect(html).toContain("Not for me"); // the clay reveal
    expect(html).toContain('draggable="false"'); // the card link never starts a native drag
  });
});
