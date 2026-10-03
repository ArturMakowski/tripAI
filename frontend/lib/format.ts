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
    [/liteapi/, "Hotel rates"],
    [/gcal/, "Google Calendar"],
    [/serper:places/, "Google Maps"],
    [/tripai\.scoring/, "TripAI"],
    [/osrm/, "OpenStreetMap"],
    [/^estimate:/, "TripAI"],
  ];
  // hand-curated sample numbers: never fetched, never recorded, say so plainly
  if (isSampleSource(source)) return "TripAI sample data";
  // an unknown id ("vendor:endpoint") is never shown raw: just the readable part, or TripAI
  return map.find(([re]) => re.test(source))?.[1] ?? (/^[a-z0-9_-]+(:|$)/i.test(source) ? "TripAI" : source);
}

/** sourceName in the UI language: only the TripAI-owned names are translated; partner brands stay as they are. */
export function sourceNameFor(source: string, names: { sample: string; scorer: string }): string {
  if (isSampleSource(source)) return names.sample;
  if (/tripai\.scoring/.test(source)) return names.scorer;
  return sourceName(source);
}

/** Every "fixture:*" source is hand-curated sample data (incl. rows saved before it was renamed
 * "fixture:sample"). Real recordings keep their real source and say "[recorded fixture]" in the label. */
export const isSampleSource = (source: string) => source.startsWith("fixture:");
