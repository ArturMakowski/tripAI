import { describe, expect, it } from "vitest";
import { en } from "./en";
import { makeFmt } from "./format";
import { pl } from "./pl";
import { plural } from "./types";

/** "trips.factors.price" -> "string" | "function" */
function shape(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") shape(v, key, out);
    else out[key] = typeof v;
  }
  return out;
}

describe("dictionaries", () => {
  it("PL and EN have exactly the same keys, and the same kind of value per key", () => {
    const e = shape(en);
    const p = shape(pl);
    expect(Object.keys(p).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) expect([k, p[k]]).toEqual([k, e[k]]);
  });

  it("no empty strings, and parametrised entries take the same number of arguments", () => {
    const walk = (a: unknown, b: unknown, path: string) => {
      if (typeof a === "string") {
        // whitespace-only connectors between bold parts are fine; truly empty strings are not
        expect(a, `en.${path}`).not.toBe("");
        expect(b as string, `pl.${path}`).not.toBe("");
      } else if (typeof a === "function") {
        expect((b as (...x: unknown[]) => string).length, `pl.${path} arity`).toBe((a as (...x: unknown[]) => string).length);
      } else if (a && typeof a === "object") {
        for (const k of Object.keys(a)) walk((a as never)[k], (b as never)[k], path ? `${path}.${k}` : k);
      }
    };
    walk(en, pl, "");
  });

  it("covers every screen namespace", () => {
    for (const ns of ["common", "calendar", "home", "onboarding", "profile", "windows", "trips", "receipt", "confirm", "credits", "survey", "inbox"])
      expect(Object.keys((en as Record<string, object>)[ns]).length, ns).toBeGreaterThan(0);
  });
});

describe("Intl formatting per locale", () => {
  const plF = makeFmt("pl");
  const enF = makeFmt("en");
  const nbsp = (s: string) => s.replace(/[  ]/g, " ");

  it("money: '1 217 zł' / '1,217 PLN'", () => {
    expect(nbsp(plF.pln(1217))).toBe("1 217 zł");
    expect(enF.pln(1217)).toBe("1,217 PLN");
    expect(nbsp(plF.signedPln(-1046))).toBe("−1 046 zł");
  });

  it("date ranges: '24–27 gru' / '24–27 Dec', across months", () => {
    expect(plF.range({ start: "2026-12-24", end: "2026-12-27" })).toBe("24–27 gru");
    expect(enF.range({ start: "2026-12-24", end: "2026-12-27" })).toBe("24–27 Dec");
    expect(plF.range({ start: "2026-12-30", end: "2027-01-02" })).toBe("30 gru – 2 sty");
  });

  it("weekday and month names", () => {
    expect(plF.weekday("2027-01-01")).toBe("pt");
    expect(enF.weekday("2027-01-01")).toBe("Fri");
    expect(plF.monthName(7)).toBe("lip");
  });

  it("Polish plurals", () => {
    const nights = (n: number) => plural("pl", n, { one: "noc", few: "noce", many: "nocy", other: "nocy" });
    expect([1, 2, 5, 22].map(nights)).toEqual(["noc", "noce", "nocy", "noce"]);
    expect(plural("en", 1, { one: "night", other: "nights" })).toBe("night");
  });
});
