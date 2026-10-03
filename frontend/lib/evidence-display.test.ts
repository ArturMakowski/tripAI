import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { pl } from "./i18n/pl";
import { evidenceDisplay } from "./evidence-display";

const crowd = (value: number, unit: string) => ({ kind: "crowds", label: "Crowds in London in January", value, unit });

describe("evidence values read honestly", () => {
  it("'0-1 rel' (no peak data) is a 0–100 scale with its anchor, never a %", () => {
    expect(evidenceDisplay(crowd(0.76, "0-1 rel"), pl.receipt)).toEqual({ label: "Tłum", value: "76/100 (0 = najspokojniejszy miesiąc)" });
    expect(evidenceDisplay(crowd(0.76, "0-1 rel"), en.receipt)).toEqual({ label: "Crowds", value: "76/100 (0 = quietest month)" });
    expect(evidenceDisplay(crowd(0.76, "0-1 rel"), pl.receipt).value).not.toMatch(/%/);
  });
  it("crowds with peak data: share of the peak season", () => {
    expect(evidenceDisplay(crowd(0.46, "0-1"), pl.receipt)).toEqual({ label: "Tłum", value: "46% szczytu sezonu" });
  });
  it("other shares and plain units", () => {
    expect(evidenceDisplay({ kind: "confidence", label: "Live data", value: 0.69, unit: "0-1" }, en.receipt).value).toBe("69%");
    expect(evidenceDisplay({ kind: "weather", label: "Avg max", value: 13.8, unit: "°C" }, en.receipt).value).toBe("13.8 °C");
  });
});
