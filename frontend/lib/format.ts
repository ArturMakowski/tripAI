import type { FreeWindow } from "./types";

const pln = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export const formatPLN = (n: number) => `${pln.format(Math.round(n))} PLN`;
export const formatSignedPLN = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${pln.format(Math.abs(Math.round(n)))} PLN`;

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function formatRange(w: Pick<FreeWindow, "start" | "end">): string {
  const s = d(w.start);
  const e = d(w.end);
  const mon = (x: Date) => x.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  if (s.getUTCMonth() === e.getUTCMonth()) return `${s.getUTCDate()}–${e.getUTCDate()} ${mon(e)}`;
  return `${s.getUTCDate()} ${mon(s)} – ${e.getUTCDate()} ${mon(e)}`;
}

export function weekday(iso: string): string {
  return d(iso).toLocaleString("en-GB", { weekday: "short", timeZone: "UTC" });
}

export function dayCount(w: Pick<FreeWindow, "start" | "end">): number {
  return Math.round((d(w.end).getTime() - d(w.start).getTime()) / 86_400_000) + 1;
}

export function eachDay(w: Pick<FreeWindow, "start" | "end">): string[] {
  const out: string[] = [];
  for (let t = d(w.start).getTime(); t <= d(w.end).getTime(); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function formatTimestamp(iso: string): string {
  const t = new Date(iso);
  return t.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Warsaw",
  });
}

export const pct = (x: number) => Math.round(x * 100);

/** "serpapi:google_flights.price_insights" -> "Google Flights" etc. */
export function sourceName(source: string): string {
  const map: [RegExp, string][] = [
    [/google_flights/, "Google Flights"],
    [/google_hotels/, "Google Hotels"],
    [/google_travel_explore/, "Google Travel Explore"],
    [/travelpayouts/, "Aviasales"],
    [/open-meteo/, "Open-Meteo"],
    [/eurostat/, "Eurostat"],
    [/opentripmap/, "OpenTripMap"],
    [/nager/, "Nager.Date"],
    [/liteapi/, "LiteAPI"],
    [/gcal/, "Google Calendar"],
    [/tripai\.scoring/, "TripAI scorer"],
  ];
  // hand-curated sample numbers: never fetched, never recorded, say so plainly
  if (isSampleSource(source)) return "TripAI sample data";
  const name = map.find(([re]) => re.test(source))?.[1] ?? source;
  // "fixture:..." = a real recorded response replayed by the backend, not a fresh fetch
  return source.startsWith("fixture:") ? `${name} (recorded)` : name;
}

export const isSampleSource = (source: string) => source === "fixture:sample";
