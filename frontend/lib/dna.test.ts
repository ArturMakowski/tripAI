import { describe, expect, it } from "vitest";
import { collectAnswers, DNA_DECK, gesturesFor, STATEMENT_ANSWER, YESNO_ANSWER } from "./dna";
import { profileDna } from "./mock/dna";

const all = (v: number) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`q${i + 1}`, v]));
const req = (answers: Record<string, number>, yes_no: Record<string, boolean> = { y1: true, y2: true }) => ({
  user_id: "demo",
  answers,
  yes_no,
});
const reason = (r: ReturnType<typeof profileDna>, field: string) => r.reasons.find((x) => x.field === field);

describe("deck (docs/TRAVEL_DNA.md)", () => {
  it("has exactly q1..q12 + y1, y2 with PL and EN copy and a bundled photo", () => {
    expect(DNA_DECK.map((c) => c.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `q${i + 1}`), "y1", "y2"]);
    for (const c of DNA_DECK) {
      expect(c.text.pl && c.text.en).toBeTruthy();
      expect(c.image).toMatch(/^\/(swipe|cities)\/[\w-]+\.jpg$/);
      expect(c.credit.license).toBeTruthy();
    }
  });
  it("maps gestures: left 1, down 3, right 4, up 5; yes/no right = yes", () => {
    expect(STATEMENT_ANSWER).toEqual({ left: 1, down: 3, right: 4, up: 5 });
    expect(YESNO_ANSWER).toEqual({ left: false, right: true });
    expect(gesturesFor(DNA_DECK[13])).toEqual(["left", "right"]);
  });
  it("collects the latest answer per card", () => {
    const a = collectAnswers([
      { id: "q1", value: 1 },
      { id: "q1", value: 5 },
      { id: "y2", value: false },
    ]);
    expect(a).toEqual({ answers: { q1: 5 }, yes_no: { y2: false } });
  });
});

describe("mock /profile/dna follows the spec formulas", () => {
  it("all 'Depends' (3) gives the documented weights", () => {
    const r = profileDna(req(all(3)));
    // raw: price .25+.175-.075=.35, weather .225, crowds .2, taste .325 -> sum 1.1
    expect(r.weights.price).toBeCloseTo(0.35 / 1.1, 4);
    expect(r.weights.weather).toBeCloseTo(0.225 / 1.1, 4);
    expect(r.weights.crowds).toBeCloseTo(0.2 / 1.1, 4);
    expect(r.weights.taste).toBeCloseTo(0.325 / 1.1, 4);
    expect(r.profile.luxury).toBe("standard");
    expect(r.profile.dislikes).toEqual([]);
  });
  it("missing answers count as 3", () => {
    expect(profileDna(req({})).weights).toEqual(profileDna(req(all(3))).weights);
  });
  it("crowd haters: q8/q11 high -> crowds weight up, dislike, offbeat interest, with reasons", () => {
    const r = profileDna(req({ ...all(3), q8: 5, q11: 4 }));
    expect(r.profile.dislikes).toEqual(["crowds"]);
    expect(r.profile.interests.offbeat).toBe(0.88); // avg(1, .75) = .875
    expect(reason(r, "weights.crowds")?.because).toEqual(["q8", "q11"]);
    expect(reason(r, "dislikes")?.because).toEqual(["q8", "q11"]);
    expect(r.weights.crowds).toBeGreaterThan(profileDna(req(all(3))).weights.crowds);
  });
  it("interests follow q5/q6/q7 and discovery uses q1 and 1-q12", () => {
    const r = profileDna(req({ ...all(1), q5: 5, q6: 3, q7: 1, q1: 5, q12: 1 }));
    expect(r.profile.interests).toMatchObject({ food: 1, culture: 1, history: 0.8, beach: 0.5, nature: 0.3, hiking: 0, discovery: 1 });
    expect(reason(r, "interests.nature")?.because).toEqual(["q6"]);
  });
  it("luxury rules in order", () => {
    expect(profileDna(req({ ...all(3), q9: 5, q10: 1 })).profile.luxury).toBe("budget");
    expect(profileDna(req({ ...all(3), q10: 5, q4: 1 })).profile.luxury).toBe("luxury");
    expect(profileDna(req({ ...all(3), q4: 2 })).profile.luxury).toBe("comfort");
  });
  it("traits keep raw answers plus pace and novelty", () => {
    const r = profileDna(req({ ...all(3), q2: 5, q3: 1 }));
    expect(r.profile.traits).toMatchObject({ q2: 5, q3: 1, pace: 1 });
    expect(reason(r, "traits.pace")?.text).toContain("structured");
  });
  it("y2 = No: neutral default weights, personalize false, stated in the reasons", () => {
    const r = profileDna(req({ ...all(5) }, { y1: false, y2: false }));
    expect(r.weights).toEqual({ price: 0.4, weather: 0.2, crowds: 0.15, taste: 0.25 });
    expect(r.profile.personalize).toBe(false);
    expect(r.profile.daily_discovery).toBe(false);
    expect(reason(r, "personalize")?.text).toMatch(/won't adapt/);
  });
});
