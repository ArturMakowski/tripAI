/**
 * Where to eat / what to do at a destination: GET /destinations/{iata}/places (backend
 * tripai.live.places). Top restaurants + things to do from Google Maps (Serper Places), cached
 * 7 days server-side. Mirrors `DestinationPlaces`; every field may be null when Google gave none,
 * and nothing here is ever filled in by us (no price level = no price shown).
 */
import type { Lang } from "./i18n/types";

export interface PlaceItem {
  kind: "restaurant" | "activity";
  name: string;
  rating: number | null;
  rating_count: number | null;
  price_level: string | null; // Google's own text, e.g. "€20–30"
  category: string | null; // already in the requested language, or null
  tags: string[];
  matches: string[]; // the user's interests this place matches
  address: string | null;
  maps_url: string | null;
  lat: number | null;
  lon: number | null;
  source: string;
  fetched_at: string;
}

export interface DestinationPlaces {
  iata: string;
  city: string;
  country: string;
  lang: Lang;
  restaurants: PlaceItem[];
  things_to_do: PlaceItem[];
  food_first: boolean;
  mode: "live" | "fixture";
  notes: Record<string, string>;
}

/** How many rows a list shows before "+N more". */
export const VISIBLE_PLACES = 3;
/** Rows asked from the backend per list (its max is 5). */
export const PLACES_LIMIT = 5;

/** Interests the backend can match on, strongest first: "food:0.9,hiking:0.7". */
export function interestsParam(interests: Record<string, number> | null | undefined): string | undefined {
  const parts = Object.entries(interests ?? {})
    .filter(([, w]) => w >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, w]) => `${k}:${Math.round(w * 100) / 100}`);
  return parts.length ? parts.join(",") : undefined;
}

export function placesPath(iata: string, lang: Lang, interests?: Record<string, number> | null): string {
  const q = new URLSearchParams({ lang, limit: String(PLACES_LIMIT) });
  const i = interestsParam(interests);
  if (i) q.set("interests", i);
  return `/destinations/${encodeURIComponent(iata)}/places?${q}`;
}

/** "★4.6 · 2.1K · €20–30 · Italian": only the parts Google gave us. */
export function placeFacts(p: PlaceItem, locale: string): string[] {
  const out: string[] = [];
  if (p.rating != null) out.push(`★${p.rating.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
  if (p.rating_count != null)
    out.push(new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(p.rating_count));
  if (p.price_level) out.push(p.price_level);
  if (p.category) out.push(p.category);
  return out;
}

/** Sections in display order: food lovers see where to eat first. */
export function placeSections(d: DestinationPlaces): { key: "eat" | "do"; items: PlaceItem[] }[] {
  const eat = { key: "eat" as const, items: d.restaurants };
  const doo = { key: "do" as const, items: d.things_to_do };
  return (d.food_first ? [eat, doo] : [doo, eat]).filter((s) => s.items.length > 0);
}
