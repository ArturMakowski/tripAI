/**
 * The scan's per-trip decisions in plain words. The backend writes short English debug reasons
 * ("fit verdict good_fit (only good/great fit notify)", "score 0.82 >= 0.70 (no fit verdict)",
 * "weekly limit reached (3/week)"); the UI never shows those, only a mapped phrase in the UI language.
 */
import type { Messages } from "./i18n";

export function plainReason(reason: string, notify: boolean, r: Messages["inbox"]["reasons"]): string {
  const s = reason.toLowerCase();
  const drop = s.match(/^-(\d+)%/);
  if (drop) return r.priceDrop(Number(drop[1]));
  // "score 0.41 < 0.70 (no fit verdict)" also mentions "fit verdict": the score rule goes first
  if (/^score /.test(s)) return notify ? r.highScore : r.lowScore;
  if (/fit verdict/.test(s)) return notify ? r.goodFit : r.weakFit;
  if (/already notified/.test(s)) return r.alreadySent;
  if (/weekly limit/.test(s)) return r.weeklyLimit;
  if (/is muted/.test(s)) return r.muted;
  if (/snoozed/.test(s)) return r.snoozed;
  if (/#1 unchanged/.test(s)) return r.unchanged;
  if (/no recommendations|no trips for/.test(s)) return r.noTrips;
  if (/no (current|exact-date) price/.test(s)) return r.noPrice;
  if (/target price alert/.test(s)) return r.coveredByTarget;
  return notify ? r.sent : r.skipped;
}
