/**
 * Travel DNA result, made personal: a persona title, the photos the user swiped right on, and the
 * ranking priorities in order. All rule-based (docs/TRAVEL_DNA.md mapping), never an LLM: the same
 * swipes always give the same persona.
 */
import { DNA_DECK, type CardId, type DnaAnswers, type DnaCard } from "./dna";
import { FACTORS, type Factor } from "./scoring";
import type { Weights } from "./types";

export type PersonaNoun = "explorer" | "foodie" | "adventurer" | "rest" | "wanderer" | "bargain" | "experiences" | "traveller";
export type PersonaMod = "curious" | "unhurried" | "organised" | "spontaneous" | "savvy" | "crowdShy";

/** A card supports a trait by a high answer (+1) or, for q12 "return to known places", a low one (−1). */
type Cue = { id: CardId; dir: 1 | -1 };

/** n(a) = (a − 1) / 4 ∈ [0, 1]; an unanswered card counts as "depends" (3). */
const n = (a: DnaAnswers, id: CardId) => ((a.answers[id] ?? 3) - 1) / 4;
const avg = (...xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

const NOUNS: { key: Exclude<PersonaNoun, "traveller">; score: (a: DnaAnswers) => number; cues: Cue[] }[] = [
  { key: "explorer", score: (a) => avg(n(a, "q1"), 1 - n(a, "q12")), cues: [{ id: "q1", dir: 1 }, { id: "q12", dir: -1 }] },
  { key: "foodie", score: (a) => n(a, "q5"), cues: [{ id: "q5", dir: 1 }] },
  { key: "adventurer", score: (a) => n(a, "q7"), cues: [{ id: "q7", dir: 1 }] },
  { key: "wanderer", score: (a) => avg(n(a, "q8"), n(a, "q11")), cues: [{ id: "q8", dir: 1 }, { id: "q11", dir: 1 }] },
  { key: "rest", score: (a) => n(a, "q6"), cues: [{ id: "q6", dir: 1 }] },
  { key: "experiences", score: (a) => avg(n(a, "q4"), n(a, "q10")), cues: [{ id: "q10", dir: 1 }, { id: "q4", dir: 1 }] },
  { key: "bargain", score: (a) => n(a, "q9"), cues: [{ id: "q9", dir: 1 }] },
];

const pace = (a: DnaAnswers) => n(a, "q2") - n(a, "q3");

const MODS: { key: PersonaMod; score: (a: DnaAnswers) => number; cues: Cue[]; not?: PersonaNoun }[] = [
  { key: "unhurried", score: (a) => n(a, "q6"), cues: [{ id: "q6", dir: 1 }], not: "rest" },
  { key: "curious", score: (a) => avg(n(a, "q1"), 1 - n(a, "q12")), cues: [{ id: "q1", dir: 1 }, { id: "q12", dir: -1 }], not: "explorer" },
  { key: "crowdShy", score: (a) => avg(n(a, "q8"), n(a, "q11")), cues: [{ id: "q11", dir: 1 }, { id: "q8", dir: 1 }], not: "wanderer" },
  { key: "savvy", score: (a) => n(a, "q9"), cues: [{ id: "q9", dir: 1 }], not: "bargain" },
  { key: "organised", score: (a) => (pace(a) > 0.25 ? n(a, "q2") : 0), cues: [{ id: "q2", dir: 1 }] },
  { key: "spontaneous", score: (a) => (pace(a) < -0.25 ? n(a, "q3") : 0), cues: [{ id: "q3", dir: 1 }] },
];

/** A noun must be strictly above neutral ("Depends" everywhere = 0.5 = no persona): "traveller". */
export const NOUN_MIN = 0.5;
/** A modifier needs a clear signal ("That's me" or stronger). */
export const MOD_MIN = 0.75;
/** DECLUTTER: the why-line stays short (≤ 2 swipes, grouped by answer). */
export const MAX_CITED = 2;

export interface Persona {
  noun: PersonaNoun;
  mod: PersonaMod | null;
  /** the 1–3 swiped cards the title rests on, strongest first */
  cited: CardId[];
}

function supports(a: DnaAnswers, c: Cue): boolean {
  const v = a.answers[c.id];
  return v != null && (c.dir > 0 ? v >= 4 : v <= 2);
}

/** A trait only counts when at least one swipe actually says so (never a title nobody swiped for). */
const backed = (a: DnaAnswers, cues: Cue[]) => cues.some((c) => supports(a, c));

export function persona(a: DnaAnswers): Persona {
  // strictly above neutral AND backed by a swipe; first in NOUNS order wins a tie (stable)
  const eligible = NOUNS.filter((x) => x.score(a) > NOUN_MIN && backed(a, x.cues));
  const top = eligible.reduce<(typeof NOUNS)[number] | null>((best, x) => (!best || x.score(a) > best.score(a) ? x : best), null);
  const noun: PersonaNoun = top?.key ?? "traveller";
  const mods = MODS.filter((m) => m.not !== noun && m.score(a) >= MOD_MIN && backed(a, m.cues));
  const mod = mods.reduce<(typeof MODS)[number] | null>((best, m) => (!best || m.score(a) > best.score(a) ? m : best), null);
  // the strongest backing swipe for the noun + the strongest for the modifier (a short why-line that
  // explains both words of the title); with no modifier, up to two for the noun
  const strongest = (cues: Cue[]) =>
    cues.filter((c) => supports(a, c)).sort((x, y) => Math.abs((a.answers[y.id] ?? 3) - 3) - Math.abs((a.answers[x.id] ?? 3) - 3));
  const nounCues = strongest(top?.cues ?? []);
  const modCues = strongest(mod?.cues ?? []);
  const picks = mod ? [...nounCues.slice(0, 1), ...modCues.slice(0, 1)] : nounCues;
  const cited = [...new Set(picks.map((c) => c.id))].slice(0, MAX_CITED);
  return { noun, mod: mod?.key ?? null, cited };
}

/** Cited swipes grouped by the answer given, in cited order: [[5, ["q5", "q9"]]] reads
 * "“So me!” on local food and price" (one answer label per group, never repeated). */
export function citedByAnswer(a: DnaAnswers, cited: CardId[]): [number, CardId[]][] {
  const groups = new Map<number, CardId[]>();
  for (const id of cited) {
    const v = a.answers[id] ?? 3;
    groups.set(v, [...(groups.get(v) ?? []), id]);
  }
  return [...groups];
}

/** Photos the user swiped right on ("That's me" or stronger, or "Yes"), the persona's own first. */
export function likedCards(a: DnaAnswers, first: CardId[] = [], max = 4): DnaCard[] {
  const liked = DNA_DECK.filter((c) =>
    c.kind === "yesno" ? a.yes_no[c.id as "y1" | "y2"] === true && c.id === "y1" : (a.answers[c.id] ?? 0) >= 4,
  );
  const rank = (c: DnaCard) => {
    const i = first.indexOf(c.id);
    return [i < 0 ? 1 : 0, i < 0 ? 0 : i, -(a.answers[c.id] ?? 4), DNA_DECK.indexOf(c)];
  };
  const cmp = (x: DnaCard, y: DnaCard) => {
    const [a1, b1] = [rank(x), rank(y)];
    for (let i = 0; i < a1.length; i++) if (a1[i] !== b1[i]) return a1[i] - b1[i];
    return 0;
  };
  return [...liked].sort(cmp).slice(0, max);
}

/** Ranking factors, most important first (stable for ties: FACTORS order). */
export function priorities(w: Weights): Factor[] {
  return [...FACTORS].sort((x, y) => w[y] - w[x] || FACTORS.indexOf(x) - FACTORS.indexOf(y));
}
