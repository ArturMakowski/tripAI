import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { airportGroups, airportLabel, airportShortName, expandToCity, formatOrigins, ORIGIN_AIRPORTS, toggleCity } from "./airports";

type SeedAirport = { iata: string; city?: Record<string, string>; label?: Record<string, string> };
const seed: SeedAirport[] = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "airports.json"), "utf8")).airports;

describe("origin airports", () => {
  it("mirror the seed (data/airports.json city + label) exactly", () => {
    const seeded = seed.filter((a) => a.label);
    expect(ORIGIN_AIRPORTS.map((a) => a.code).sort()).toEqual(seeded.map((a) => a.iata).sort());
    for (const a of ORIGIN_AIRPORTS) {
      const s = seeded.find((x) => x.iata === a.code)!;
      expect(a.city).toEqual(s.city);
      expect(a.label).toEqual(s.label);
    }
  });

  it("name Modlin as Warszawa-Modlin (WMI), never a bare Modlin", () => {
    expect(airportLabel("WMI", "pl")).toBe("Warszawa-Modlin (WMI)");
    expect(airportLabel("WMI", "en")).toBe("Warsaw Modlin (WMI)");
    expect(airportLabel("WAW", "pl")).toBe("Warszawa-Chopin (WAW)");
    expect(airportLabel("KTW", "pl")).toBe("Katowice-Pyrzowice (KTW)");
    expect(airportLabel("KRK", "en")).toBe("Kraków (KRK)");
    expect(airportLabel("fco", "pl")).toBe("FCO");
    for (const a of ORIGIN_AIRPORTS) for (const l of ["pl", "en"] as const) expect(a.label[l].startsWith(a.city[l])).toBe(true);
  });

  it("group WAW and WMI under Warszawa, in picker order", () => {
    const pl = airportGroups("pl");
    expect(pl.map((g) => g.city)).toEqual(["Kraków", "Warszawa", "Katowice", "Gdańsk", "Wrocław", "Poznań", "Rzeszów"]);
    expect(pl[1].airports.map((a) => [a.code, airportShortName(a, "pl")])).toEqual([
      ["WAW", "Chopin"],
      ["WMI", "Modlin"],
    ]);
    expect(airportGroups("en")[1]).toMatchObject({ city: "Warsaw" });
    expect(airportShortName(ORIGIN_AIRPORTS[0], "pl")).toBe("");
  });

  it("summarise a selection with full names", () => {
    expect(formatOrigins(["KRK", "WMI"], "pl")).toBe("Kraków (KRK), Warszawa-Modlin (WMI)");
  });

  it("choosing a city covers all its airports", () => {
    expect(expandToCity(["WAW"])).toEqual(["WAW", "WMI"]);
    expect(expandToCity(["wmi", "KRK"])).toEqual(["KRK", "WAW", "WMI"]);
    expect(expandToCity(["KTW", "XYZ"])).toEqual(["KTW", "XYZ"]);
    const warszawa = airportGroups("pl")[1].airports;
    expect(toggleCity(["KRK"], warszawa)).toEqual(["KRK", "WAW", "WMI"]);
    expect(toggleCity(["KRK", "WAW", "WMI"], warszawa)).toEqual(["KRK"]);
    expect(toggleCity(["WAW"], warszawa)).toEqual(["WAW", "WMI"]); // half-selected city -> whole city
  });
});
