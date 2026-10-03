/** Presentation helpers for Recommendation.fit (docs/FIT_VERDICT.md). */
import { ANSWER_LABEL, DNA_CARD, YESNO_LABEL, type CardId, type Lang } from "./dna";
import * as copy from "./i18n/messages/receipt";
import type { Recommendation, TasteProfile } from "./types";

const FIT_TONE: Record<string, { tone: string; dot: string }> = {
  great_fit: { tone: "bg-pine text-paper", dot: "bg-paper" },
  good_fit: { tone: "bg-pine-soft text-pine-deep", dot: "bg-pine" },
  mixed: { tone: "bg-sun-soft text-ink", dot: "bg-sun" },
  poor_fit: { tone: "bg-clay-soft text-ink", dot: "bg-clay" },
};

const fitCopy = (lang: Lang) => (lang === "pl" ? copy.pl : copy.en).fit;

export const fitMeta = (label: string, lang: Lang = "en") => {
  const names = fitCopy(lang).labels as Record<string, string>;
  const tone = FIT_TONE[label] ?? { tone: "bg-paper-deep text-ink", dot: "bg-ink" };
  return { label: names[label] ?? label, ...tone };
};

/** Score and verdict pointing in different directions: shown openly, never smoothed over. */
export function disagreement(rec: Recommendation): "high_score_poor_fit" | "low_score_good_fit" | null {
  if (!rec.fit) return null;
  const good = rec.fit.label === "great_fit" || rec.fit.label === "good_fit";
  const bad = rec.fit.label === "poor_fit" || rec.fit.label === "mixed";
  if (rec.score.total >= 0.75 && bad) return "high_score_poor_fit";
  if (rec.score.total < 0.65 && good) return "low_score_good_fit";
  return null;
}

/** "you swiped „Bardzo ja!” on: Lubię podróżować z dala od tłumów" (one line per cited card). */
export function dnaQuotes(ids: string[], profile: TasteProfile | null, lang: Lang): string[] {
  // Personalize = No: the verdict used neutral DNA, so quoting the real answers would be misleading.
  if (!profile || profile.personalize === false) return [];
  const t = profile.traits ?? {};
  return ids
    .map((id) => DNA_CARD[id as CardId])
    .filter(Boolean)
    .flatMap((card) => {
      let answer: string;
      if (card.kind === "yesno") {
        const v = card.id === "y1" ? profile.daily_discovery : profile.personalize;
        if (v == null) return []; // never answered: never quoted
        answer = v ? YESNO_LABEL[lang].yes : YESNO_LABEL[lang].no;
      } else {
        const v = t[card.id];
        if (typeof v !== "number" || !ANSWER_LABEL[lang][v]) return []; // never answered: never quoted
        answer = ANSWER_LABEL[lang][v];
      }
      return [fitCopy(lang).swiped(answer, card.text[lang])];
    });
}
