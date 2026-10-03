import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cityPhoto, cityPhotoCredit, fallbackHue } from "./photos";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const publicFile = (src: string) => fileURLToPath(new URL(`../public${src}`, import.meta.url));

type SeedCity = { id: string; name: string; iata: string; airports: string[] };
const cities: SeedCity[] = JSON.parse(read("../../data/cities.json")).cities;
const credits = read("../public/cities/CREDITS.md");

describe("city photos cover every seed destination", () => {
  it.each(cities)("$name ($iata) and all its airports resolve to a bundled, credited photo", (city) => {
    for (const code of new Set([city.iata, ...city.airports])) {
      const src = cityPhoto(code);
      expect(src, `${city.name}: no photo for ${code}`).toBe(`/cities/${city.id}.jpg`);
      expect(existsSync(publicFile(src!)), `${src} missing`).toBe(true);
      expect(cityPhotoCredit(code)).toMatchObject({ author: expect.any(String), license: expect.any(String) });
    }
    const src = cityPhoto(city.iata)!;
    expect(statSync(publicFile(src)).size).toBeLessThan(250_000);
    const credit = cityPhotoCredit(city.iata)!;
    expect(credit.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect(credits).toContain(`\`${src}\``);
    expect(credits).toContain(credit.source);
  });

  it("covers every destination in the backend scorer catalogue", () => {
    const provider = read("../../backend/src/tripai/scoring/provider.py");
    const codes = [...provider.matchAll(/_c\("[^"]+", "[^"]+", "([A-Z]{3})"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const src = cityPhoto(code);
      expect(src, `no photo for ${code}`).not.toBeNull();
      expect(existsSync(publicFile(src!))).toBe(true);
      expect(statSync(publicFile(src!)).size).toBeLessThan(250_000);
      expect(credits).toContain(cityPhotoCredit(code)!.source);
    }
  });

  it("is case-insensitive and returns null for unknown codes", () => {
    expect(cityPhoto("pmi")).toBe("/cities/palma.jpg");
    expect(cityPhoto("XXX")).toBeNull();
    expect(cityPhotoCredit("XXX")).toBeNull();
  });

  it("derives a stable fallback hue from the city name", () => {
    expect(fallbackHue("Gdańsk")).toBe(fallbackHue("Gdańsk"));
    expect(fallbackHue("Gdańsk")).not.toBe(fallbackHue("Tbilisi"));
    expect(fallbackHue("Gdańsk")).toBeGreaterThanOrEqual(0);
    expect(fallbackHue("Gdańsk")).toBeLessThan(360);
  });
});
