/**
 * T6 swipe on offers: contract mirror, copy (PL + EN) and the in-browser stand-in for
 * backend/src/tripai/scoring/reactions.py. The live API decides; this mirror only answers in
 * fixture mode, so its rules must stay identical (pinned by lib/reactions.test.ts).
 */
import type { Lang } from "./dna";
import { normalise } from "./scoring";
import type { Change, RankedRecommendation, TasteProfile, Weights } from "./types";

// --- contract (api/schemas.py: ReactionRequest / ReactionResponse) -------------------------

/** like = "Chcę tam" (→), dislike = "Nie dla mnie" (←), love = "Super!" (↑) */
export type Reaction = "like" | "dislike" | "love";

export interface ReactionRequest {
  recommendation_id: string;
  reaction: Reaction;
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
const LOVE_FACTOR_MIN = 0.8;
const DISLIKE_FACTOR_MAX = 0.4;
const WEIGHT_FACTORS = ["price", "weather", "crowds"] as const;
const FACTORS = ["price", "weather", "crowds", "taste"] as const;
const VERB: Record<Reaction, string> = {
  like: "you swiped 'Chcę tam' on",
  love: "you swiped 'Super!' on",
  dislike: "you swiped 'Nie dla mnie' on",
};

const r2 = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

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
): ReactionResponse & { undo: ReactionUndo } {
  const before = roundW(normalise(weights));
  const hidden = reaction === "dislike";
  const base = { recommendation_id: rec.id, reaction, city: rec.city, hidden };
  if (profile.personalize === false) {
    let note =
      "Personalisation is off (your choice in Travel DNA), so this reaction is saved but does not change your profile or weights.";
    if (hidden) note += ` ${rec.city} on these dates is hidden from your list.`;
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
  const label = `${rec.city} (${ddmm(rec.window.start)}-${ddmm(rec.window.end)})`;
  const interests = { ...profile.interests };
  const tagDiff: Change[] = [];
  const interestsBefore: Record<string, number | null> = {};
  for (const tag of [...new Set(rec.tags ?? [])]) {
    const old = interests[tag] ?? null;
    if (old === null && reaction === "dislike") continue; // never invent an interest from a dislike
    const next = r2((old ?? 0.5) + TAG_STEP[reaction]);
    if (next === old) continue;
    interestsBefore[tag] = old;
    interests[tag] = next;
    tagDiff.push({ field: `interests.${tag}`, before: old, after: next, reason: `${VERB[reaction]} ${label}, which offers ${tag}` });
  }

  let cause: (typeof WEIGHT_FACTORS)[number] | null = null;
  let reason = "";
  const s = rec.score;
  if (reaction === "love") {
    const f = [...WEIGHT_FACTORS].sort((a, b) => s[b] - s[a])[0]; // stable: first wins ties
    if (s[f] >= LOVE_FACTOR_MIN) [cause, reason] = [f, `${VERB[reaction]} ${label}; its ${f} score was ${s[f].toFixed(2)}`];
  } else if (reaction === "dislike") {
    const f = [...WEIGHT_FACTORS].sort((a, b) => s[a] - s[b])[0];
    if (s[f] < DISLIKE_FACTOR_MAX) [cause, reason] = [f, `${VERB[reaction]} ${label}; its ${f} score was only ${s[f].toFixed(2)}`];
  }
  let after = before;
  if (cause) after = roundW(normalise({ ...before, [cause]: before[cause] + WEIGHT_STEP }));
  const diff = [...weightDiff(before, after, cause, reason), ...tagDiff];

  let note: string | null = hidden ? `${rec.city} on these dates is hidden from your list.` : null;
  if (!diff.length) {
    const nothing = "Nothing new to learn: your profile already says this.";
    note = note ? `${note} ${nothing}` : nothing;
  }
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

function weightDiff(before: Weights, after: Weights, cause: string | null, reason: string): Change[] {
  return FACTORS.filter((f) => Math.abs(after[f] - before[f]) >= 0.005)
    .map((f) => ({
      field: `weights.${f}`,
      before: before[f],
      after: after[f],
      reason: f === cause ? reason : "re-normalised after another weight changed",
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
): ReactionResponse {
  const interests = { ...profile.interests };
  const diff: Change[] = [];
  const kept: string[] = [];
  const reason = `undo: ${rec.city}`;
  for (const [tag, old] of Object.entries(undo.interestsBefore)) {
    const after = undo.diff.find((c) => c.field === `interests.${tag}`)?.after ?? null;
    const cur = interests[tag] ?? null;
    if (cur !== after) {
      kept.push(tag);
      continue;
    }
    if (old === null) delete interests[tag];
    else interests[tag] = old;
    diff.push({ field: `interests.${tag}`, before: cur, after: old, reason });
  }
  let w = roundW(normalise(weights));
  if (!sameW(undo.weightsBefore, undo.weightsAfter)) {
    if (sameW(w, undo.weightsAfter)) {
      diff.unshift(...weightDiff(w, undo.weightsBefore, null, reason).map((c) => ({ ...c, reason })));
      w = undo.weightsBefore;
    } else kept.push("weights");
  }
  return {
    recommendation_id: rec.id,
    reaction: null,
    city: rec.city,
    profile: { ...profile, interests },
    weights: w,
    diff,
    note: kept.length ? `Kept ${kept.join(", ")}: changed again since this swipe.` : null,
    hidden: false,
    learned: [],
  };
}

// --- copy (PL first, EN toggle; moves to lib/i18n once that lands) -------------------------

export const SWIPE_COPY = {
  pl: {
    list: "Lista",
    swipe: "Swipe",
    viewLabel: "Widok ofert",
    like: "Chcę tam",
    dislike: "Nie dla mnie",
    love: "Super!",
    undo: "Cofnij",
    hint: "Przesuń w prawo, w lewo lub w górę. Strzałki też działają, Backspace cofa.",
    learnedLike: (city: string, tags: string) => `Zapamiętane: lubisz ${city}${tags ? `: ${tags}` : ""}`,
    learnedLove: (city: string, tags: string) => `Zapamiętane: uwielbiasz ${city}${tags ? `: ${tags}` : ""}`,
    learnedDislike: (city: string, tags: string) => `Zapamiętane: ${city} nie dla Ciebie${tags ? `. Mniej: ${tags}` : ""}`,
    nothingNew: (city: string) => `Zapamiętane: ${city}. Twój profil już to wie`,
    frozen: "Zapisane, ale profil się nie zmienia (personalizacja wyłączona w Travel DNA)",
    weightUp: (factor: string) => `${factor} ważniejsze`,
    hiddenNote: "ukryte z listy",
    watching: "obserwujemy cenę",
    watchFull: "lista obserwowanych pełna",
    watchDemo: "alerty cenowe działają z live API",
    undone: (city: string) => `Cofnięte: ${city}`,
    doneTitle: "To wszystkie oferty",
    doneBody: (n: number) => `${n} reakcji. Ranking przeliczy się z Twoim nowym profilem.`,
    showRanking: "Pokaż nowy ranking",
    pendingNote: "Ranking przeliczy się z nowym profilem, gdy wrócisz do listy.",
    refining: "Chwila, dopracowujemy ceny. Swipe ruszy za moment.",
    empty: "Brak nowych ofert do oceny.",
    hiddenTitle: "Ukryte",
    show: "pokaż",
    hide: "zwiń",
    restore: "Przywróć",
    saved: "Zapisane",
    total: "razem",
    of: "z",
  },
  en: {
    list: "List",
    swipe: "Swipe",
    viewLabel: "Offer view",
    like: "I want to go",
    dislike: "Not for me",
    love: "Love it!",
    undo: "Undo",
    hint: "Swipe right, left or up. Arrow keys work too, Backspace undoes.",
    learnedLike: (city: string, tags: string) => `Learned: you like ${city}${tags ? `: ${tags}` : ""}`,
    learnedLove: (city: string, tags: string) => `Learned: you love ${city}${tags ? `: ${tags}` : ""}`,
    learnedDislike: (city: string, tags: string) => `Learned: ${city} isn't for you${tags ? `. Less: ${tags}` : ""}`,
    nothingNew: (city: string) => `Saved: ${city}. Your profile already knew that`,
    frozen: "Saved, but your profile stays as is (personalisation is off in Travel DNA)",
    weightUp: (factor: string) => `${factor} matters more`,
    hiddenNote: "hidden from your list",
    watching: "watching the price",
    watchFull: "watch list is full",
    watchDemo: "price alerts need the live API",
    undone: (city: string) => `Undone: ${city}`,
    doneTitle: "That's every offer",
    doneBody: (n: number) => `${n} reactions. The ranking will update with your new profile.`,
    showRanking: "Show the new ranking",
    pendingNote: "The ranking updates with your new profile when you go back to the list.",
    refining: "One moment, refining prices. Swiping starts shortly.",
    empty: "No new offers to rate.",
    hiddenTitle: "Hidden",
    show: "show",
    hide: "hide",
    restore: "Restore",
    saved: "Saved",
    total: "total",
    of: "of",
  },
} as const;

const TAG_LABEL: Record<Lang, Record<string, string>> = {
  pl: {
    food: "jedzenie",
    history: "historia",
    art: "sztuka",
    architecture: "architektura",
    beach: "plaża",
    nightlife: "życie nocne",
    culture: "kultura",
    nature: "natura",
    hiking: "wędrówki",
    wellness: "wellness",
    offbeat: "mniej turystycznie",
    discovery: "odkrywanie",
    city: "miasto",
    viewpoints: "punkty widokowe",
    surf: "surfing",
    diving: "nurkowanie",
    sun: "słońce",
    pizza: "pizza",
    museums: "muzea",
    romance: "romantyzm",
    design: "design",
    cycling: "rower",
    whisky: "whisky",
    festivals: "festiwale",
    walking: "spacery",
  },
  en: { offbeat: "off the beaten path", viewpoints: "viewpoints" },
};

const FACTOR_LABEL: Record<Lang, Record<string, string>> = {
  pl: { price: "Cena", weather: "Pogoda", crowds: "Mniej tłumów", taste: "Gust" },
  en: { price: "Price", weather: "Weather", crowds: "Fewer crowds", taste: "Taste" },
};

export function tagLabel(tag: string, lang: Lang): string {
  return TAG_LABEL[lang][tag] ?? tag.replace(/_/g, " ");
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
  const t = SWIPE_COPY[lang];
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
    weight ? t.weightUp(FACTOR_LABEL[lang][weight.field.slice("weights.".length)] ?? weight.field) : null,
    res.hidden ? t.hiddenNote : null,
    opts.watch === "ok" ? t.watching : opts.watch === "full" ? t.watchFull : opts.watch === "demo" ? t.watchDemo : null,
  ].filter(Boolean);
  return [head, ...extras].join(" · ");
}

/** Gesture <-> reaction (the deck reuses the Travel DNA swipe interaction). */
export const GESTURE_REACTION = { right: "like", left: "dislike", up: "love" } as const satisfies Record<string, Reaction>;
export type OfferGesture = keyof typeof GESTURE_REACTION;
