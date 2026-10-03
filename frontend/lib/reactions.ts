/**
 * T6 swipe on offers: contract mirror, copy (PL + EN) and the in-browser stand-in for
 * backend/src/tripai/scoring/reactions.py. The live API decides; this mirror only answers in
 * fixture mode, so its rules must stay identical (pinned by lib/reactions.test.ts).
 */
import { en } from "./i18n/en";
import { pl } from "./i18n/pl";
import type { Lang } from "./dna";
import { normalise } from "./scoring";
import type { Change, RankedRecommendation, TasteProfile, Weights } from "./types";

// --- contract (api/schemas.py: ReactionRequest / ReactionResponse) -------------------------

/** like = "Chcę tam" (→), dislike = "Nie dla mnie" (←), love = "Super!" (↑) */
export type Reaction = "like" | "dislike" | "love";

export interface ReactionRequest {
  recommendation_id: string;
  reaction: Reaction;
  /** language of `diff[].reason` and `note` (backend tripai.i18n) */
  lang?: Lang;
  profile?: TasteProfile | null;
  weights?: Weights | null;
}

export interface ReactionResponse {
  recommendation_id: string;
  reaction: Reaction | null; // null after an undo
  city: string;
  profile: TasteProfile;
  weights: Weights;
  diff: Change[]; // same shape as /feedback's diff
  note: string | null;
  hidden: boolean;
  learned: string[];
}

// --- rules (mirror of scoring/reactions.py) -----------------------------------------------

export const TAG_STEP: Record<Reaction, number> = { like: 0.05, love: 0.1, dislike: -0.05 };
export const WEIGHT_STEP = 0.03;
/** New interests adopted per like/love; they start at the step, not 0.5 (each one dilutes every other city). */
export const MAX_NEW_TAGS = 1;
const LOVE_FACTOR_MIN = 0.8;
const DISLIKE_FACTOR_MAX = 0.4;
const WEIGHT_FACTORS = ["price", "weather", "crowds"] as const;
const FACTORS = ["price", "weather", "crowds", "taste"] as const;

/** Backend texts (tripai.i18n MESSAGES "rx.*", "fb.renorm", "factor.*"), so fixture mode reads the same. */
const RX = {
  en: {
    swipe: { like: "I want to go", love: "Love it!", dislike: "Not for me" } as Record<Reaction, string>,
    tag: (sw: string, trip: string, tag: string) => `you swiped '${sw}' on ${trip}, which offers ${tag}`,
    loveFactor: (sw: string, trip: string, f: string, v: string) => `you swiped '${sw}' on ${trip}; its ${f} score was ${v}`,
    dislikeFactor: (sw: string, trip: string, f: string, v: string) => `you swiped '${sw}' on ${trip}; its ${f} score was only ${v}`,
    off: "Personalisation is off (your choice in Travel DNA), so this reaction is saved but does not change your profile or weights.",
    hidden: (city: string) => `${city} on these dates is hidden from your list.`,
    nothing: "Nothing new to learn: your profile already says this.",
    renorm: "re-normalised after another weight changed",
    undo: (city: string) => `undo: ${city}`,
    kept: (fields: string) => `Kept ${fields}: changed again since this swipe.`,
    factor: { price: "price", weather: "weather", crowds: "crowds", taste: "taste", weights: "weights" } as Record<string, string>,
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
  pl: {
    swipe: { like: "Chcę tam", love: "Super!", dislike: "Nie dla mnie" } as Record<Reaction, string>,
    tag: (sw: string, trip: string, tag: string) => `„${sw}” przy ${trip}, a to miejsce oferuje: ${tag}`,
    loveFactor: (sw: string, trip: string, f: string, v: string) => `„${sw}” przy ${trip}; wynik „${f}” to ${v}`,
    dislikeFactor: (sw: string, trip: string, f: string, v: string) => `„${sw}” przy ${trip}; wynik „${f}” to tylko ${v}`,
    off: "Personalizacja jest wyłączona (Twój wybór w DNA Podróżnika), więc reakcja jest zapisana, ale nie zmienia Twojego profilu ani wag.",
    hidden: (city: string) => `${city} w tych dniach znika z Twojej listy.`,
    nothing: "Nic nowego: Twój profil już to wie.",
    renorm: "przeliczona po zmianie innej wagi",
    undo: (city: string) => `cofnięte: ${city}`,
    kept: (fields: string) => `Bez zmian: ${fields} (zmienione ponownie po tym przesunięciu).`,
    factor: { price: "cena", weather: "pogoda", crowds: "tłumy", taste: "gust", weights: "wagi" } as Record<string, string>,
    months: ["sty", "lut", "mar", "kwi", "maja", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
  },
};

const r2 = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const fixed2 = (v: number, lang: Lang) => (lang === "pl" ? v.toFixed(2).replace(".", ",") : v.toFixed(2));

/** Same as tripai.i18n.fmt_dates: "14–19 Jan" / "30 Dec–2 Jan" (pl: "14–19 sty"). */
function fmtDates(start: string, end: string, lang: Lang): string {
  const m = RX[lang].months;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (start === end) return `${sd} ${m[sm - 1]}`;
  if (sy === ey && sm === em) return `${sd}–${ed} ${m[sm - 1]}`;
  return `${sd} ${m[sm - 1]}–${ed} ${m[em - 1]}`;
}

/** Undo snapshot kept next to each swipe (backend keeps the same in the `reactions` table). */
export interface ReactionUndo {
  interestsBefore: Record<string, number | null>;
  diff: Change[];
  weightsBefore: Weights;
  weightsAfter: Weights;
}

export function applyReaction(
  profile: TasteProfile,
  weights: Weights,
  rec: Pick<RankedRecommendation, "id" | "city" | "window" | "tags" | "score">,
  reaction: Reaction,
  lang: Lang = "en",
): ReactionResponse & { undo: ReactionUndo } {
  const tx = RX[lang];
  const before = roundW(normalise(weights));
  const hidden = reaction === "dislike";
  const base = { recommendation_id: rec.id, reaction, city: rec.city, hidden };
  if (profile.personalize === false) {
    let note = tx.off;
    if (hidden) note += ` ${tx.hidden(rec.city)}`;
    return {
      ...base,
      profile,
      weights: before,
      diff: [],
      note,
      learned: [],
      undo: { interestsBefore: {}, diff: [], weightsBefore: before, weightsAfter: before },
    };
  }
  const label = `${rec.city} (${fmtDates(rec.window.start, rec.window.end, lang)})`;
  const sw = tx.swipe[reaction];
  const interests = { ...profile.interests };
  const tagDiff: Change[] = [];
  const interestsBefore: Record<string, number | null> = {};
  let newTags = 0;
  for (const tag of [...new Set(rec.tags ?? [])]) {
    const old = interests[tag] ?? null;
    if (old === null) {
      if (reaction === "dislike" || newTags >= MAX_NEW_TAGS) continue; // never invent from a dislike; adopt few
      newTags++;
    }
    const next = r2((old ?? 0) + TAG_STEP[reaction]);
    if (next === old) continue;
    interestsBefore[tag] = old;
    interests[tag] = next;
    tagDiff.push({ field: `interests.${tag}`, before: old, after: next, reason: tx.tag(sw, label, tagLabel(tag, lang)) });
  }

  let cause: (typeof WEIGHT_FACTORS)[number] | null = null;
  let reason = "";
  const s = rec.score;
  if (reaction === "love") {
    const f = [...WEIGHT_FACTORS].sort((a, b) => s[b] - s[a])[0]; // stable: first wins ties
    if (s[f] >= LOVE_FACTOR_MIN) [cause, reason] = [f, tx.loveFactor(sw, label, tx.factor[f], fixed2(s[f], lang))];
  } else if (reaction === "dislike") {
    const f = [...WEIGHT_FACTORS].sort((a, b) => s[a] - s[b])[0];
    if (s[f] < DISLIKE_FACTOR_MAX) [cause, reason] = [f, tx.dislikeFactor(sw, label, tx.factor[f], fixed2(s[f], lang))];
  }
  let after = before;
  if (cause) after = roundW(normalise({ ...before, [cause]: before[cause] + WEIGHT_STEP }));
  const diff = [...weightDiff(before, after, cause, reason, tx.renorm), ...tagDiff];

  let note: string | null = hidden ? tx.hidden(rec.city) : null;
  if (!diff.length) note = note ? `${note} ${tx.nothing}` : tx.nothing;
  return {
    ...base,
    profile: { ...profile, interests },
    weights: after,
    diff,
    note,
    learned: tagDiff.map((c) => c.field.slice("interests.".length)),
    undo: { interestsBefore, diff, weightsBefore: before, weightsAfter: after },
  };
}

function roundW(w: Weights): Weights {
  return { price: r4(w.price), weather: r4(w.weather), crowds: r4(w.crowds), taste: r4(w.taste) };
}

function weightDiff(before: Weights, after: Weights, cause: string | null, reason: string, renorm: string): Change[] {
  return FACTORS.filter((f) => Math.abs(after[f] - before[f]) >= 0.005)
    .map((f) => ({
      field: `weights.${f}`,
      before: before[f],
      after: after[f],
      reason: f === cause ? reason : renorm,
    }))
    .sort((a, b) => Number(a.field !== `weights.${cause}`) - Number(b.field !== `weights.${cause}`));
}

const sameW = (a: Weights, b: Weights) => FACTORS.every((f) => Math.abs(normalise(a)[f] - normalise(b)[f]) < 0.005);

/** Revert one swipe field by field, unless that field changed again since (mirror of undo_reaction). */
export function undoReaction(
  profile: TasteProfile,
  weights: Weights,
  rec: { id: string; city: string },
  undo: ReactionUndo,
  lang: Lang = "en",
): ReactionResponse {
  const tx = RX[lang];
  const interests = { ...profile.interests };
  const diff: Change[] = [];
  const kept: string[] = [];
  const reason = tx.undo(rec.city);
  for (const [tag, old] of Object.entries(undo.interestsBefore)) {
    const after = undo.diff.find((c) => c.field === `interests.${tag}`)?.after ?? null;
    const cur = interests[tag] ?? null;
    if (cur !== after) {
      kept.push(tagLabel(tag, lang));
      continue;
    }
    if (old === null) delete interests[tag];
    else interests[tag] = old;
    diff.push({ field: `interests.${tag}`, before: cur, after: old, reason });
  }
  let w = roundW(normalise(weights));
  if (!sameW(undo.weightsBefore, undo.weightsAfter)) {
    if (sameW(w, undo.weightsAfter)) {
      diff.unshift(...weightDiff(w, undo.weightsBefore, null, reason, reason));
      w = undo.weightsBefore;
    } else kept.push(tx.factor.weights);
  }
  return {
    recommendation_id: rec.id,
    reaction: null,
    city: rec.city,
    profile: { ...profile, interests },
    weights: w,
    diff,
    note: kept.length ? tx.kept(kept.join(", ")) : null,
    hidden: false,
    learned: [],
  };
}

// --- copy: lib/i18n/messages/swipeOffers.ts (follows the global PL/EN setting) -------------

/** The swipe copy for a language, for non-React callers (toasts are built outside components). */
export const swipeCopy = (lang: Lang) => (lang === "pl" ? pl.swipeOffers : en.swipeOffers);

export function tagLabel(tag: string, lang: Lang): string {
  return (swipeCopy(lang).tags as Record<string, string>)[tag] ?? tag.replace(/_/g, " ");
}

/**
 * The tiny toast after a swipe: what was learned, in words. At most three tags, the ones the
 * swipe moved furthest up (like/love) or that are now lowest (dislike).
 */
export function toastText(
  res: Pick<ReactionResponse, "reaction" | "city" | "diff" | "hidden" | "learned">,
  lang: Lang,
  opts: { personalized?: boolean; watch?: "ok" | "full" | "demo" | null } = {},
): string {
  const t = swipeCopy(lang);
  if (opts.personalized === false) return [t.frozen, res.hidden ? t.hiddenNote : null].filter(Boolean).join(" · ");
  const tagChanges = res.diff.filter((c) => c.field.startsWith("interests."));
  const ordered = [...tagChanges].sort((a, b) =>
    res.reaction === "dislike" ? Number(a.after) - Number(b.after) : Number(b.after) - Number(a.after),
  );
  const tags = ordered
    .slice(0, 3)
    .map((c) => tagLabel(c.field.slice("interests.".length), lang))
    .join(", ");
  const weight = res.diff.find((c) => c.field.startsWith("weights.") && !c.reason.startsWith("re-normalised"));
  let head: string;
  if (!res.diff.length) head = t.nothingNew(res.city);
  else if (res.reaction === "love") head = t.learnedLove(res.city, tags);
  else if (res.reaction === "dislike") head = t.learnedDislike(res.city, tags);
  else head = t.learnedLike(res.city, tags);
  const extras = [
    weight ? t.weightUp((t.factors as Record<string, string>)[weight.field.slice("weights.".length)] ?? weight.field) : null,
    res.hidden ? t.hiddenNote : null,
    opts.watch === "ok" ? t.watching : opts.watch === "full" ? t.watchFull : opts.watch === "demo" ? t.watchDemo : null,
  ].filter(Boolean);
  return [head, ...extras].join(" · ");
}

/** Gesture <-> reaction (the deck reuses the Travel DNA swipe interaction). */
export const GESTURE_REACTION = { right: "like", left: "dislike", up: "love" } as const satisfies Record<string, Reaction>;
export type OfferGesture = keyof typeof GESTURE_REACTION;
