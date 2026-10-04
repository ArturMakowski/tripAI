/**
 * Time to value (T19, docs/USER_TESTING.md): welcome → 14 swipes → one confirm tap → ranked trips. The confirm
 * comes pre-filled (next long weekend, 1 person, default airport) and the DNA result is applied without a stop.
 * Pure functions; the onboarding page and Profile call them.
 */
import { type DateRange, type ISODate, usableRanges } from "./date-range";
import { nextLongWeekend } from "./home-today";
import { expandToCity } from "./airports";
import type { BridgeWindow, DnaResponse, TasteProfile } from "./types";

/** Airport preselected when the user never picked one (the deck's initial state). */
export const DEFAULT_AIRPORTS = ["KRK"];

/**
 * Dates to preselect on the confirm step: the next długi weekend (backend radar first, else local PL
 * holidays + bridge days, the same range as the "Najbliższy długi weekend" chip), marked as that quick
 * pick so the chip shows selected. Null when the user already has dates /trips can use: those are kept.
 */
export function prefillDates(ranges: DateRange[], radar: BridgeWindow[], today: ISODate): DateRange | null {
  if (usableRanges(ranges, today).length) return null;
  const lw = nextLongWeekend(radar, today);
  return lw ? { start: lw.start, end: lw.end, quick: "long" } : null;
}

/**
 * The profile a DNA result gives, keeping what the user set elsewhere: the optional hard budget, and
 * (unless the confirm step passes new ones) airports and party size. A city covers all its airports
 * (Warszawa = WAW + WMI); flights are priced × travellers, the stay per room.
 */
export function profileFromDna(
  result: DnaResponse,
  prev: TasteProfile | null,
  trip: { airports?: string[]; party?: number | null } = {},
): TasteProfile {
  const airports = trip.airports?.length ? trip.airports : prev?.origin_airports?.length ? prev.origin_airports : DEFAULT_AIRPORTS;
  const party = trip.party ?? null;
  return {
    ...result.profile,
    budget_pln: prev?.budget_pln ?? null,
    origin_airports: expandToCity(airports),
    adults: party ?? prev?.adults ?? 1,
    children: party != null ? 0 : (prev?.children ?? 0),
    rooms: party != null ? null : (prev?.rooms ?? null),
  };
}
