// T16 review: the home "#1" is exactly the /trips #1 (one selector, lib/trip-list.ts).
import { describe, expect, it } from "vitest";
import { addDays } from "./date-range";
import { DEMO_PROFILE } from "./mock/fixtures";
import { fastEstimates, scoreLocally, withPriceStatus } from "./mock/api";
import { DEFAULT_WEIGHTS, SLIDER_PRESETS } from "./scoring";
import { listedTrips, rankedView, topTrip } from "./trip-list";
import type { RankedRecommendation } from "./types";

const TODAY = "2026-10-04";
const stored = withPriceStatus(scoreLocally(DEMO_PROFILE, DEFAULT_WEIGHTS));
const view = (recs: RankedRecommendation[], weights = DEFAULT_WEIGHTS, fixture = true) =>
  rankedView(recs, weights, { fixture, profile: DEMO_PROFILE, lang: "pl" });
const none = new Set<string>();

describe("topTrip (home #1 = /trips #1)", () => {
  it("is the first trip of the /trips list", () => {
    const ranked = view(stored);
    expect(topTrip(ranked, none, TODAY)?.id).toBe(listedTrips(ranked, none, TODAY)[0].id);
  });

  it("skips a trip swiped 'Nie dla mnie' (hidden), like /trips", () => {
    const ranked = view(stored);
    const first = topTrip(ranked, none, TODAY)!;
    const next = topTrip(ranked, new Set([first.id]), TODAY)!;
    expect(next.id).not.toBe(first.id);
    expect(next.id).toBe(listedTrips(ranked, none, TODAY).filter((r) => r.id !== first.id)[0].id);
  });

  it("follows the current weights, not the stored rank (slider / survey without a refetch)", () => {
    const comfort = topTrip(view(stored, SLIDER_PRESETS[1].weights), none, TODAY)!;
    const price = topTrip(view(stored, SLIDER_PRESETS[0].weights), none, TODAY)!;
    // the demo flips #1 when the slider goes to Price (README demo script: Athens takes #1)
    expect(price.id).not.toBe(comfort.id);
    // and the stored rank field is ignored: reversing it changes nothing
    const scrambled = stored.map((r, i) => ({ ...r, rank: stored.length - i }));
    expect(topTrip(view(scrambled, SLIDER_PRESETS[0].weights), none, TODAY)?.id).toBe(price.id);
  });

  it("drops poor_fit and trips that already started", () => {
    const ranked = view(stored, DEFAULT_WEIGHTS, false);
    const [a, b] = listedTrips(ranked, none, TODAY);
    const poor = ranked.map((r) => (r.id === a.id ? { ...r, fit: { ...r.fit!, label: "poor_fit" as const } } : r));
    expect(topTrip(poor, none, TODAY)?.id).toBe(b.id);
    // the day after a's trip starts, a is gone from the list (and so can't be home's #1)
    expect(listedTrips(ranked, none, addDays(a.window.start, 1)).map((r) => r.id)).not.toContain(a.id);
    expect(topTrip(ranked, none, "2099-01-01")).toBeNull();
  });

  it("lists everything until today is known (prerender)", () => {
    const ranked = view(stored);
    expect(listedTrips(ranked, none, null).length).toBe(ranked.filter((r) => r.fit?.label !== "poor_fit").length);
  });
});

describe("fast phase: fit not judged yet (fit = null) never means 'Not your style'", () => {
  // live mode, phase=fast: estimate prices, no verdicts at all
  const fast = fastEstimates(withPriceStatus(scoreLocally(DEMO_PROFILE, DEFAULT_WEIGHTS))).map((r) => ({ ...r, fit: null }));

  it("keeps every unjudged trip in the main ranked list, by score, with no verdict made up", () => {
    const ranked = view(fast, DEFAULT_WEIGHTS, false);
    expect(ranked.every((r) => r.fit == null)).toBe(true); // no client-side guess (it labelled most trips poor_fit)
    const listed = listedTrips(ranked, none, TODAY);
    expect(listed.map((r) => r.id)).toEqual(ranked.filter((r) => r.window.start >= TODAY).map((r) => r.id));
    expect(listed.length).toBeGreaterThan(0);
    const scores = listed.map((r) => r.score.total);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("only an actual poor_fit verdict moves a trip out of the main list", () => {
    const ranked = view(fast, DEFAULT_WEIGHTS, false);
    const judged = ranked.map((r, i) => (i === 0 ? { ...r, fit: { ...r, label: "poor_fit" } as never } : r));
    const listed = listedTrips(judged, none, TODAY);
    expect(listed.some((r) => r.id === judged[0].id)).toBe(false);
    expect(listed.length).toBe(listedTrips(ranked, none, TODAY).length - 1);
  });

  it("home #1 = /trips #1 in the fast phase too", () => {
    const ranked = view(fast, DEFAULT_WEIGHTS, false);
    expect(topTrip(ranked, none, TODAY)?.id).toBe(listedTrips(ranked, none, TODAY)[0].id);
    expect(topTrip(ranked, none, TODAY)).not.toBeNull();
  });
});
