import { describe, expect, it } from "vitest";
import type { CardId, DnaAnswers } from "./dna";
import { likedCards, MOD_MIN, NOUN_MIN, persona, priorities } from "./dna-persona";
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
    expect(p.cited.length).toBeLessThanOrEqual(3);
    for (const id of p.cited) {
      const v = a.answers[id]!;
      expect(id === "q12" ? v <= 2 : v >= 4).toBe(true);
    }
  });

  it("never pairs a trait with itself and falls back to an all-rounder", () => {
    expect(persona(ans({ q6: 5 })).mod).not.toBe("unhurried"); // "rest" noun
    const flat = ans(Object.fromEntries(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11"].map((q) => [q, 2])));
    expect(persona(flat)).toMatchObject({ noun: "traveller", mod: null });
    expect(title("en", flat)).toBe("The all-round traveller");
    expect(NOUN_MIN).toBeLessThan(MOD_MIN);
  });

  it("pace modifiers follow the plan-vs-spontaneous trait", () => {
    expect(persona(ans({ q5: 5, q2: 5, q3: 1 })).mod).toBe("organised");
    expect(persona(ans({ q5: 5, q2: 1, q3: 5 })).mod).toBe("spontaneous");
    expect(title("pl", ans({ q5: 5, q2: 1, q3: 5 }))).toBe("Smakosz bez sztywnego planu");
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
});
