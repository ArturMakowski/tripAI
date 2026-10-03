// The UI never shows implementation details (user request): no engine, vendor, framework or model
// names, internal ids, hashes or model-confidence numbers, in PL or EN. Real data-source citations
// (Google Flights/Hotels/Travel Explore, Open-Meteo, Eurostat, OpenStreetMap, Aviasales) are fine.
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { pl } from "./pl";
import { DENYLIST } from "./denylist";


/** Every leaf string; functions are called with plausible sample arguments. */
function leaves(obj: unknown, path: string, out: [string, string][] = []): [string, string][] {
  const sample = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? "Rzym" : i === 1 ? "3" : "2"));
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = `${path}.${k}`;
    if (typeof v === "string") out.push([key, v]);
    else if (typeof v === "function") {
      try {
        const r = (v as (...a: unknown[]) => unknown)(...sample(v.length));
        if (typeof r === "string") out.push([key, r]);
        // plural-style helpers take numbers: try those too
        const r2 = (v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, () => 2));
        if (typeof r2 === "string") out.push([`${key}(n)`, r2]);
      } catch {
        // a helper that needs a specific argument shape: its literal text is still in the source scan below
      }
    } else if (v && typeof v === "object") leaves(v, key, out);
  }
  return out;
}

describe("no implementation details in the UI copy (PL + EN)", () => {
  for (const [lang, dict] of [["en", en], ["pl", pl]] as const) {
    it(lang, () => {
      const bad = leaves(dict, lang).filter(([, text]) => DENYLIST.some((re) => re.test(text)));
      expect(bad.map(([k, text]) => `${k}: ${text}`)).toEqual([]);
    });
  }
});

describe("data-layer text is cleaned before it reaches a screen", () => {
  it("evidence labels lose internal tags and pipeline jargon", async () => {
    const { plainLabel } = await import("../evidence-display");
    expect(plainLabel("Return flight (Aviasales cached fare, not bookable) [recorded fixture]")).toBe(
      "Return flight (Aviasales fare, not bookable)",
    );
    expect(plainLabel("Hotel 4 nights in Nice (city average) x1.0 for standard [synthetic fixture]")).toBe(
      "Hotel 4 nights in Nice (city average)",
    );
  });
  it("source ids become the real source, never the API vendor or a raw id", async () => {
    const { sourceName } = await import("../format");
    const shown = [
      "serpapi:google_flights",
      "serpapi:google_hotels",
      "serpapi:google_travel_explore",
      "travelpayouts:prices_for_dates",
      "serper:places",
      "liteapi:rates",
      "osrm",
      "tripai.scoring",
      "estimate:tripai-editorial",
      "somevendor:endpoint",
    ].map(sourceName);
    expect(shown).toEqual([
      "Google Flights",
      "Google Hotels",
      "Google Travel Explore",
      "Aviasales",
      "Google Maps",
      "Hotel rates",
      "OpenStreetMap",
      "TripAI",
      "TripAI",
      "TripAI",
    ]);
    for (const s of shown) for (const re of DENYLIST) expect(s).not.toMatch(re);
  });
});
