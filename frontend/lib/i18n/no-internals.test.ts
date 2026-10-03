// The UI never shows implementation details (user request): no engine, vendor, framework or model
// names, internal ids, hashes or model-confidence numbers, in PL or EN. Real data-source citations
// (Google Flights/Hotels/Travel Explore, Open-Meteo, Eurostat, OpenStreetMap, Aviasales) are fine.
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { pl } from "./pl";
import { readFileSync } from "node:fs";
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
        // every helper returns a string with these sample arguments today; a future one that throws is
        // reported by the "dictionaries" test's arity check, not silently skipped here
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

describe("backend i18n strings that reach the UI (backend/src/tripai/i18n.py)", () => {
  it("no implementation details in any PL/EN value", () => {
    const src = readFileSync(new URL("../../../backend/src/tripai/i18n.py", import.meta.url), "utf8");
    // every "en": "…" / "pl": "…" value (adjacent string literals are joined, as Python does)
    const values = [...src.matchAll(/"(en|pl)":\s*((?:"(?:[^"\\]|\\.)*"\s*)+)/g)].map((m) => [
      m[1],
      [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join(""),
    ]);
    expect(values.length).toBeGreaterThan(100); // the file was found and parsed
    const bad = values.filter(([, v]) => DENYLIST.some((re) => re.test(v)));
    expect(bad.map(([l, v]) => `${l}: ${v}`)).toEqual([]);
  });
});

describe("the render paths that put data-layer text on screen", () => {
  /** Labels the live provider really writes (live/provider.py, connectors/travelpayouts.py, connectors/base.py). */
  const LIVE_LABELS = [
    "Return KRK-NCE dep 11 Nov, back 15 Nov, Wizz direct (Aviasales cached fare, not bookable)",
    "Return flight KRK-NCE (median of 7 Aviasales cached fares, not your exact dates)",
    "Hotel 4 nights in Nice (Google Travel Explore, not your exact dates) x1.0 for standard",
    "Return KRK-ATH 6-10 Jan · Ryanair (cached calendar fare)",
    "Avg daily max in Rome 14-19 Jan [synthetic fixture]",
    "Top sights [recorded fixture]",
  ];

  it("hand-off links, evidence rows and their tooltips (demo trips + live-shaped labels)", async () => {
    const { scoreLocally, fastEstimates, withPriceStatus } = await import("../mock/api");
    const { DEMO_PROFILE } = await import("../mock/fixtures");
    const { DEFAULT_WEIGHTS } = await import("../scoring");
    const { handoffLinks } = await import("../handoff");
    const { evidenceDisplay, plainLabel } = await import("../evidence-display");
    const { sourceName } = await import("../format");
    const base = withPriceStatus(scoreLocally(DEMO_PROFILE, DEFAULT_WEIGHTS));
    const live = base.map((r, i) => ({
      ...r,
      evidence: r.evidence.map((e, j) =>
        e.kind === "flight" || e.kind === "hotel"
          ? { ...e, label: LIVE_LABELS[(i + j) % LIVE_LABELS.length], url: "https://partner.example/deal", source: "travelpayouts:grouped_prices" }
          : { ...e, label: `${e.label} ${LIVE_LABELS[(i + j) % LIVE_LABELS.length]}` },
      ),
    }));
    const shown: string[] = [];
    for (const lang of ["pl", "en"] as const) {
      const { MESSAGES } = await import("./index");
      const r = MESSAGES[lang].receipt;
      for (const rec of [...base, ...fastEstimates(base), ...live]) {
        shown.push(...handoffLinks(rec, "KRK", r.handoff).map((l) => l.label));
        for (const e of rec.evidence) {
          shown.push(evidenceDisplay(e, r).label, plainLabel(e.label), sourceName(e.source));
        }
      }
    }
    const bad = [...new Set(shown)].filter((t) => DENYLIST.some((re) => re.test(t)));
    expect(bad).toEqual([]);
  });

  it("trip-detail transfer notes (demo hotels)", async () => {
    const { sampleHotel } = await import("../mock/trip-details");
    const notes = ["FCO", "LIS", "ATH", "VCE", "OPO"]
      .map((iata) => sampleHotel(iata, iata, 1000))
      .flatMap((h) => h?.transfers.map((t) => t.note ?? "") ?? []);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.filter((n) => DENYLIST.some((re) => re.test(n)))).toEqual([]);
  });
});
