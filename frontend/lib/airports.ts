/**
 * Polish origin airports offered in the app, mirrored from data/airports.json (`city`, `label`;
 * backend tripai.seed.airports.ORIGIN_LABELS, kept in sync by lib/airports.test.ts). A secondary
 * airport is always named with the city it serves and grouped under it: "Warszawa-Modlin (WMI)"
 * sits with "Warszawa-Chopin (WAW)" under Warszawa, never as a bare "Modlin".
 */
import type { Lang } from "./i18n/types";

export interface OriginAirport {
  code: string;
  city: Record<Lang, string>;
  label: Record<Lang, string>;
}

/** Picker order: busiest first, airports of one city next to each other. */
export const ORIGIN_AIRPORTS: OriginAirport[] = [
  { code: "KRK", city: { pl: "Kraków", en: "Kraków" }, label: { pl: "Kraków", en: "Kraków" } },
  { code: "WAW", city: { pl: "Warszawa", en: "Warsaw" }, label: { pl: "Warszawa-Chopin", en: "Warsaw Chopin" } },
  { code: "WMI", city: { pl: "Warszawa", en: "Warsaw" }, label: { pl: "Warszawa-Modlin", en: "Warsaw Modlin" } },
  { code: "KTW", city: { pl: "Katowice", en: "Katowice" }, label: { pl: "Katowice-Pyrzowice", en: "Katowice-Pyrzowice" } },
  { code: "GDN", city: { pl: "Gdańsk", en: "Gdańsk" }, label: { pl: "Gdańsk", en: "Gdańsk" } },
  { code: "WRO", city: { pl: "Wrocław", en: "Wrocław" }, label: { pl: "Wrocław", en: "Wrocław" } },
  { code: "POZ", city: { pl: "Poznań", en: "Poznań" }, label: { pl: "Poznań", en: "Poznań" } },
  { code: "RZE", city: { pl: "Rzeszów", en: "Rzeszów" }, label: { pl: "Rzeszów-Jasionka", en: "Rzeszów-Jasionka" } },
];

const BY_CODE = new Map(ORIGIN_AIRPORTS.map((a) => [a.code, a]));

/** "Warszawa-Modlin (WMI)"; an airport we don't label keeps its bare code. */
export function airportLabel(code: string, lang: Lang): string {
  const a = BY_CODE.get(code.toUpperCase());
  return a ? `${a.label[lang]} (${a.code})` : code.toUpperCase();
}

/** The part of the label after the city: "Modlin", "Chopin", "Pyrzowice"; "" when it is just the city. */
export function airportShortName(a: OriginAirport, lang: Lang): string {
  const city = a.city[lang];
  const label = a.label[lang];
  return label.startsWith(city) ? label.slice(city.length).replace(/^[-\s]+/, "") : label;
}

/** Airports grouped by the city they serve, in picker order. */
export function airportGroups(lang: Lang): { city: string; airports: OriginAirport[] }[] {
  const groups: { city: string; airports: OriginAirport[] }[] = [];
  for (const a of ORIGIN_AIRPORTS) {
    const g = groups.find((x) => x.city === a.city[lang]);
    if (g) g.airports.push(a);
    else groups.push({ city: a.city[lang], airports: [a] });
  }
  return groups;
}

/** Every airport of the cities in `codes`, in picker order: choosing Warszawa means WAW + WMI
 * (the backend then sends ONE search for the city, tripai.scoring.origins). Unknown codes stay. */
export function expandToCity(codes: string[]): string[] {
  const picked = new Set(codes.map((c) => c.toUpperCase()));
  const cities = new Set(ORIGIN_AIRPORTS.filter((a) => picked.has(a.code)).map((a) => a.city.en));
  const known = ORIGIN_AIRPORTS.filter((a) => cities.has(a.city.en)).map((a) => a.code);
  const unknown = [...picked].filter((c) => !BY_CODE.has(c));
  return [...known, ...unknown];
}

/** Toggle a whole city: all its airports on, or (if all were on) all off. */
export function toggleCity(codes: string[], city: OriginAirport[]): string[] {
  const group = city.map((a) => a.code);
  const allOn = group.every((c) => codes.includes(c));
  return allOn ? codes.filter((c) => !group.includes(c)) : [...codes, ...group.filter((c) => !codes.includes(c))];
}

/** "Kraków (KRK), Warszawa-Modlin (WMI)" for summaries. */
export const formatOrigins = (codes: string[], lang: Lang) => codes.map((c) => airportLabel(c, lang)).join(", ");
