/** Presentation helpers for Recommendation.fit (docs/FIT_VERDICT.md). */
import { ANSWER_LABEL, DNA_CARD, YESNO_LABEL, type CardId, type Lang } from "./dna";
import { CLIENT_PREVIEW_MODEL } from "./mock/fit";
import type { FitVerdict, Recommendation, TasteProfile } from "./types";

export const FIT_META: Record<string, { label: string; tone: string; dot: string }> = {
  great_fit: { label: "Great fit", tone: "bg-pine text-paper", dot: "bg-paper" },
  good_fit: { label: "Good fit", tone: "bg-pine-soft text-pine-deep", dot: "bg-pine" },
  mixed: { label: "Mixed fit", tone: "bg-sun-soft text-ink", dot: "bg-sun" },
  poor_fit: { label: "Not your style", tone: "bg-clay-soft text-ink", dot: "bg-clay" },
};

export const fitMeta = (label: string) => FIT_META[label] ?? { label, tone: "bg-paper-deep text-ink", dot: "bg-ink" };

export function modelLabel(fit: FitVerdict): string {
  if (fit.model === CLIENT_PREVIEW_MODEL) return "Rule-based check · preview computed on this device";
  if (fit.model === "rules" || fit.model.startsWith("rules")) return "Rule-based check";
  return `AI check · ${fit.model}`;
}

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
      // English frame (the app UI), answer + statement in the deck language the user swiped in.
      const q = lang === "pl" ? `„${answer}”` : `“${answer}”`;
      return [`you swiped ${q} on: ${card.text[lang]}`];
    });
}
