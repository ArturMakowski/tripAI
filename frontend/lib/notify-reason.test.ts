import { describe, expect, it } from "vitest";
import { MESSAGES } from "./i18n";
import { DENYLIST } from "./i18n/denylist";
import { plainReason } from "./notify-reason";

const BACKEND_REASONS: [string, boolean][] = [
  ["fit verdict good_fit", true],
  ["fit verdict poor_fit (only good/great fit notify)", false],
  ["score 0.82 >= 0.70 (no fit verdict)", true],
  ["score 0.41 < 0.70 (no fit verdict)", false],
  ["already notified", false],
  ["weekly limit reached (3/week)", false],
  ["Rome is muted", false],
  ["snoozed until 2026-10-05 08:00", false],
  ["#1 unchanged", false],
  ["no recommendations", false],
  ["no trips for Wszystkich Świętych", false],
  ["no current price for this pick", false],
  ["no exact-date price for this pick (estimate)", false],
  ["covered by the target price alert", false],
  ["-12%; fit verdict great_fit", true],
  ["something new from a future backend", false],
];

describe("scan reasons in plain words", () => {
  it.each(["pl", "en"] as const)("%s: every backend reason maps to product language", (lang) => {
    const r = MESSAGES[lang].inbox.reasons;
    for (const [reason, notify] of BACKEND_REASONS) {
      const out = plainReason(reason, notify, r);
      expect(out, reason).not.toMatch(/verdict|good_fit|poor_fit|>=|0\.\d\d|\/week/);
      for (const re of DENYLIST) expect(out, reason).not.toMatch(re);
    }
    expect(plainReason("-12%; fit verdict great_fit", true, r)).toBe(r.priceDrop(12));
    expect(plainReason("score 0.41 < 0.70 (no fit verdict)", false, r)).toBe(r.lowScore);
  });
});
