import { describe, expect, it } from "vitest";
import type { CardId, DnaAnswers } from "./dna";
import { citedByAnswer, likedCards, MAX_CITED, MOD_MIN, NOUN_MIN, persona, priorities } from "./dna-persona";
import { messagesFor } from "./i18n";

const ans = (a: Partial<Record<CardId, number>>, yes: Partial<Record<"y1" | "y2", boolean>> = {}): DnaAnswers => ({ answers: a, yes_no: yes });
const title = (lang: "pl" | "en", a: DnaAnswers) => {
  const p = persona(a);
  const t = messagesFor(lang).onboarding.persona;
  return t.title(t.nouns[p.noun], p.mod ? t.mods[p.mod] : null);
};

describe("Travel DNA persona (rule-based, no LLM)", () => {
  it("names the strongest trait and the clearest secondary one", () => {
    const a = ans({ q5: 5, q6: 4, q1: 3, q12: 3, q9: 2 });
    expect(persona(a)).toEqual({ noun: "foodie", mod: "unhurried", cited: ["q5", "q6"] });
    expect(title("en", a)).toBe("The unhurried foodie");
    expect(title("pl", a)).toBe("Smakosz bez pośpiechu"); // noun + phrase: no gendered adjective
  });

  it("is deterministic and cites only swipes that actually support it (max 3)", () => {
    const a = ans({ q1: 5, q12: 1, q8: 5, q11: 5, q9: 5 });
    const p = persona(a);
    expect(persona(a)).toEqual(p);
    expect(p.noun).toBe("explorer");
    expect(p.cited.length).toBeLessThanOrEqual(MAX_CITED);
    for (const id of p.cited) {
      const v = a.answers[id]!;
      expect(id === "q12" ? v <= 2 : v >= 4).toBe(true);
    }
  });

  it("never pairs a trait with itself and falls back to an all-rounder", () => {
    expect(persona(ans({ q6: 5 })).mod).not.toBe("unhurried"); // "rest" noun
    const flat = ans(Object.fromEntries(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11"].map((q) => [q, 2])));
    expect(persona(flat)).toMatchObject({ noun: "traveller", mod: null });
    expect(title("en", flat)).toBe("The traveller");
    expect(NOUN_MIN).toBeLessThan(MOD_MIN);
  });

  const ALL_Q = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12"] as const;
  const every = (v: number) => ans(Object.fromEntries(ALL_Q.map((q) => [q, v])));

  it.each([
    ["no swipes", ans({})],
    ["all “Depends”", every(3)],
    ["all “Not me”", every(1)],
  ])("%s -> plain traveller, nothing cited (no title the swipes don't back)", (_name, a) => {
    expect(persona(a)).toEqual({ noun: "traveller", mod: null, cited: [] });
    expect(title("en", a)).toBe("The traveller");
    expect(title("pl", a)).toBe("Podróżnik");
  });

  it("all “So me!”: a backed noun and modifier, every cited swipe really says so", () => {
    const a = every(5);
    const p = persona(a);
    expect(p.noun).not.toBe("traveller");
    expect(p.noun).not.toBe("explorer"); // q12 "So me!" (returning) cancels discovering: not above neutral
    expect(p.mod).not.toBeNull();
    expect(p.cited.length).toBeGreaterThan(0);
    for (const id of p.cited) expect(a.answers[id]).toBe(5);
  });

  it("a modifier needs its own supporting swipe", () => {
    // curious via q12 "Not me" (returning) alone is backed by that very swipe, and cited
    const p = persona(ans({ q5: 5, q12: 1 }));
    expect(p.mod).toBe("curious");
    expect(p.cited).toEqual(["q5", "q12"]);
    // no swipe backs "unhurried" at q6=3 even if other answers are strong
    expect(persona(ans({ q5: 5, q6: 3 })).mod).toBeNull();
  });

  it("pace modifiers follow the plan-vs-spontaneous trait", () => {
    expect(persona(ans({ q5: 5, q2: 5, q3: 1 })).mod).toBe("organised");
    expect(persona(ans({ q5: 5, q2: 1, q3: 5 })).mod).toBe("spontaneous");
    expect(title("pl", ans({ q5: 5, q2: 1, q3: 5 }))).toBe("Smakosz bez sztywnego planu");
  });

  it("cites one swipe for each word of the title (noun + modifier)", () => {
    // the screenshot profile: "The crowd-shy explorer"
    const a = ans({ q1: 5, q2: 1, q3: 4, q4: 4, q5: 5, q6: 4, q7: 3, q8: 5, q9: 4, q10: 1, q11: 5, q12: 1 });
    expect(persona(a)).toEqual({ noun: "explorer", mod: "crowdShy", cited: ["q1", "q11"] });
    expect(citedByAnswer(a, persona(a).cited)).toEqual([[5, ["q1", "q11"]]]); // one "So me!" group
  });

  it("why-line groups the cited swipes by answer (the label never repeats)", () => {
    const a = ans({ q5: 5, q9: 5, q6: 4 });
    expect(citedByAnswer(a, ["q5", "q9"])).toEqual([[5, ["q5", "q9"]]]);
    expect(citedByAnswer(a, ["q5", "q6"])).toEqual([[5, ["q5"]], [4, ["q6"]]]);
    const t = messagesFor("en").onboarding;
    const parts = citedByAnswer(a, ["q5", "q9"]).map(([v, ids]) => t.becausePart(t.answers[v as 5], t.persona.cards(ids.map((id) => id))));
    expect(t.persona.why(parts)).toBe("Because you swiped “So me!” on q5 and q9.");
  });

  it("why-sentence lists the cited swipes in both languages", () => {
    expect(messagesFor("en").onboarding.persona.why(["a", "b", "c"])).toBe("Because you swiped a, b and c.");
    expect(messagesFor("pl").onboarding.persona.why(["a", "b"])).toBe("Bo zaznaczono a i b.");
  });
});

describe("collage + priorities", () => {
  it("shows right-swiped photos, the persona's own first; never the tailoring yes/no card", () => {
    const a = ans({ q3: 4, q5: 5, q6: 1, q7: 5 }, { y1: true, y2: true });
    const ids = likedCards(a, ["q7"]).map((c) => c.id);
    expect(ids[0]).toBe("q7");
    expect(ids).toEqual(expect.arrayContaining(["q5", "q3"]));
    expect(ids).not.toContain("q6");
    expect(ids).not.toContain("y2");
    expect(likedCards(ans({ q1: 1 }))).toEqual([]);
    expect(likedCards(ans({ q1: 5, q2: 5, q3: 5, q4: 5, q5: 5 })).length).toBe(4);
  });

  it("orders ranking factors by weight, as a sentence without numbers", () => {
    const order = priorities({ price: 0.4, weather: 0.15, crowds: 0.15, taste: 0.3 });
    expect(order).toEqual(["price", "taste", "weather", "crowds"]); // tie keeps the factor order
    expect(messagesFor("en").onboarding.priorities.most("price", "taste")).toBe("Price matters most, then taste.");
    expect(messagesFor("pl").onboarding.priorities.most("cena", "gust")).toBe("Najbardziej liczy się cena, potem gust.");
    expect(messagesFor("en").onboarding.priorities.most("price", "taste")).not.toMatch(/%|\d/);
  });

  it("reads grammatically whichever factor leads (review: “Crowds matters most”)", () => {
    for (const lang of ["en", "pl"] as const) {
      const p = messagesFor(lang).onboarding.priorities;
      const order = priorities({ price: 0.14, weather: 0.2, crowds: 0.3, taste: 0.275 });
      expect(order[0]).toBe("crowds");
      const sentence = p.most(p.phrase[order[0]], p.phrase[order[1]]);
      expect(sentence).toBe(lang === "en" ? "Avoiding crowds matters most, then taste." : "Najbardziej liczy się unikanie tłumów, potem gust.");
    }
    const en = messagesFor("en").onboarding.priorities;
    expect(en.most(en.phrase.weather, en.phrase.price)).toBe("The weather matters most, then price.");
  });
});
