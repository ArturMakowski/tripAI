/**
 * The one ranking every screen shows (T16 review): /trips and the home "#1" both read it, so they can't
 * disagree. Pure functions over the stored recs; nothing here fetches.
 */
import type { Lang } from "./i18n/types";
import { withReceipts } from "./mock/api";
import { CLIENT_PREVIEW_MODEL, withFit } from "./mock/fit";
import { rerank } from "./scoring";
import type { RankedRecommendation, TasteProfile, Weights } from "./types";
import { withValueBadges } from "./value";

/** Stored recs ranked under the current weights, with fit verdicts and (fixture) receipts + value badges. */
export function rankedView(
  recs: RankedRecommendation[],
  weights: Weights,
  { fixture, profile, lang }: { fixture: boolean; profile: TasteProfile; lang: Lang },
): RankedRecommendation[] {
  // Fixture verdicts are always derived from this ranking (drop any stored one so it can't go stale).
  const r = fixture ? withReceipts(rerank(recs, weights), weights, lang).map((x) => ({ ...x, fit: undefined })) : rerank(recs, weights);
  // Backend verdicts win; until the fit agent ships, a rule-based preview is computed here and labelled as such.
  const fitted = withFit(r, profile, fixture ? "rules" : CLIENT_PREVIEW_MODEL, lang);
  // Value badges compare against the current top 5, so in fixture mode they follow the ranking like fit does.
  return fixture ? withValueBadges(fitted.map((x) => ({ ...x, value_badge: undefined, value_reason: undefined })), lang) : fitted;
}

/**
 * The ranked list as /trips numbers it: without trips swiped "Nie dla mnie", without "not my style"
 * (poor_fit, listed separately), and, once today is known on the client, without trips that already started.
 */
export function listedTrips<T extends RankedRecommendation>(ranked: T[], hidden: Set<string>, today: string | null): T[] {
  return ranked.filter((r) => !hidden.has(r.id) && r.fit?.label !== "poor_fit" && (today == null || r.window.start >= today));
}

/** The #1 on /trips (home's "Twój nr 1"). */
export const topTrip = <T extends RankedRecommendation>(ranked: T[], hidden: Set<string>, today: string): T | null =>
  listedTrips(ranked, hidden, today)[0] ?? null;
