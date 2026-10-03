import { describe, expect, it } from "vitest";
import { applyReaction, toastText, undoReaction } from "./reactions";
import type { RankedRecommendation, TasteProfile, Weights } from "./types";

const W: Weights = { price: 0.4, weather: 0.2, crowds: 0.15, taste: 0.25 };
const PROFILE: TasteProfile = {
  user_id: "u1",
  origin_airports: ["KRK"],
  budget_pln: 2500,
  luxury: "standard",
  interests: { food: 0.9, history: 0.7 },
  dislikes: [],
  preferred_temp_c: [15, 26],
  trip_length_days: [3, 7],
};

function rec(score: Partial<RankedRecommendation["score"]> = {}, tags = ["food", "history", "city"]) {
  return {
    id: "FCO-20270114-20270119",
    city: "Rome",
    window: { start: "2027-01-14", end: "2027-01-19", source: "manual" },
    tags,
    score: { price: 0.6, weather: 0.6, crowds: 0.6, taste: 0.6, total: 0.6, ...score },
  };
}

// Same cases as backend/tests/test_reactions.py: the fixture-mode mirror must agree with the API.
describe("applyReaction mirrors tripai.scoring.reactions", () => {
  it("like nudges every city tag by +0.05 (one new tag, from the step) and never touches weights", () => {
    const r = applyReaction(PROFILE, W, rec(), "like");
    expect(r.profile.interests).toEqual({ food: 0.95, history: 0.75, city: 0.05 });
    expect(r.weights).toEqual(W);
    expect(r.diff.map((c) => c.field)).toEqual(["interests.food", "interests.history", "interests.city"]);
    expect(r.diff[2].before).toBeNull();
    expect(r.diff.every((c) => c.reason.includes("Rome") && c.reason.includes("I want to go"))).toBe(true);
    expect(r.learned).toEqual(["food", "history", "city"]);
    expect(r.hidden).toBe(false);
  });

  it("love is +0.10, clamped at 1, and raises the weight of a factor that scored >= 0.8", () => {
    const r = applyReaction(PROFILE, W, rec({ crowds: 0.9 }), "love");
    expect(r.profile.interests.food).toBe(1);
    expect(r.profile.interests.history).toBe(0.8);
    expect(r.weights.crowds).toBeGreaterThan(W.crowds);
    expect(Object.values(r.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(r.diff[0].field).toBe("weights.crowds");
    expect(r.diff[0].reason).toContain("crowds score was 0.90");
    const again = applyReaction(r.profile, r.weights, rec({ crowds: 0.9 }), "love");
    expect(again.diff.some((c) => c.field === "interests.food")).toBe(false);
  });

  it("dislike only lowers existing interests, hides, and weights the weakest factor below 0.4", () => {
    const r = applyReaction(PROFILE, W, rec({ price: 0.2, crowds: 0.3 }), "dislike");
    expect(r.profile.interests).toEqual({ food: 0.85, history: 0.65 });
    expect(r.hidden).toBe(true);
    expect(r.note).toContain("hidden");
    expect(r.diff[0].field).toBe("weights.price");
    expect(r.diff[0].reason).toContain("only 0.20");
  });

  it("mild cards never move weights", () => {
    expect(applyReaction(PROFILE, W, rec(), "love").weights).toEqual(W);
    expect(applyReaction(PROFILE, W, rec(), "dislike").weights).toEqual(W);
  });

  it("personalize=false records the reaction but changes nothing and says so", () => {
    const off = { ...PROFILE, personalize: false };
    const r = applyReaction(off, W, rec({ crowds: 0.95 }), "love");
    expect(r.diff).toEqual([]);
    expect(r.profile).toBe(off);
    expect(r.note).toContain("Personalisation is off");
    expect(applyReaction(off, W, rec(), "dislike").hidden).toBe(true);
  });

  it("undo restores exactly, and keeps a field that changed again since", () => {
    const r = applyReaction(PROFILE, W, rec({ crowds: 0.9 }), "love");
    const u = undoReaction(r.profile, r.weights, { id: r.recommendation_id, city: "Rome" }, r.undo);
    expect(u.profile.interests).toEqual(PROFILE.interests);
    expect(u.weights).toEqual(W);
    expect(u.note).toBeNull();
    const moved = { ...r.profile, interests: { ...r.profile.interests, food: 0.3 } };
    const u2 = undoReaction(moved, r.weights, { id: r.recommendation_id, city: "Rome" }, r.undo);
    expect(u2.profile.interests.food).toBe(0.3);
    expect(u2.profile.interests.city).toBeUndefined();
    expect(u2.note).toContain("food");
  });
});

describe("Polish texts match the backend (tripai.i18n rx.*)", () => {
  it("writes reasons, notes and undo in Polish", () => {
    const r = applyReaction(PROFILE, W, rec({ price: 0.2 }), "dislike", "pl");
    expect(r.diff[0].reason).toBe("„Nie dla mnie” przy Rome (14–19 sty); wynik „cena” to tylko 0,20");
    expect(r.diff[1].reason).toBe("przeliczona po zmianie innej wagi");
    expect(r.diff.some((c) => c.reason.includes("oferuje: jedzenie"))).toBe(true);
    expect(r.note).toBe("Rome w tych dniach znika z Twojej listy.");
    const u = undoReaction(r.profile, r.weights, { id: r.recommendation_id, city: "Rome" }, r.undo, "pl");
    expect(new Set(u.diff.map((c) => c.reason))).toEqual(new Set(["cofnięte: Rome"]));
  });
});

describe("toastText", () => {
  it("says what was learned, in Polish first", () => {
    const r = applyReaction(PROFILE, W, rec(), "like");
    expect(toastText(r, "pl", { watch: "ok" })).toBe("Zapamiętane: lubisz Rome: jedzenie, historia, miasto · obserwujemy cenę");
    expect(toastText(r, "en")).toBe("Learned: you like Rome: food, history, city");
    const two = applyReaction(PROFILE, W, rec({}, ["food", "history", "city", "art"]), "like");
    expect(Object.keys(two.profile.interests)).toEqual(["food", "history", "city"]); // at most one new tag
  });

  it("dislike lists the lowered tags, the weight that moved and that it is hidden", () => {
    const r = applyReaction(PROFILE, W, rec({ crowds: 0.2 }), "dislike");
    expect(toastText(r, "pl")).toBe("Zapamiętane: Rome nie dla Ciebie. Mniej: historia, jedzenie · Mniej tłumów ważniejsze · ukryte z listy");
  });

  it("personalize=false and nothing-new are explicit", () => {
    const off = applyReaction({ ...PROFILE, personalize: false }, W, rec(), "love");
    expect(toastText(off, "pl", { personalized: false })).toContain("personalizacja wyłączona");
    const none = applyReaction({ ...PROFILE, interests: {} }, W, rec(), "dislike");
    expect(toastText(none, "en")).toBe("Saved: Rome. Your profile already knew that · hidden from your list");
  });
});
