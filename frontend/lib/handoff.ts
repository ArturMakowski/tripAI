import { plainLabel } from "./evidence-display";
import { estimatedLeg, moneyOf } from "./money";
import type { Recommendation } from "./types";

/**
 * Departure airport the scorer actually priced: the itinerary's first leg, else the flight evidence
 * label (a city search reads "WAW/WMI-BCN": its first airport, never a guess from the middle), else
 * the profile's first airport.
 */
export function originOf(rec: Recommendation, fallback = "KRK"): string {
  const leg = rec.flight?.outbound?.[0]?.from_iata;
  if (leg) return leg;
  const label = rec.evidence.find((e) => e.kind === "flight")?.label ?? "";
  return label.match(/\b([A-Z]{3})(?:[/,][A-Z]{3})*[-–]([A-Z]{3})\b/)?.[1] ?? fallback;
}

/** "2026-11-07" -> "0711" (Aviasales search URLs use DDMM). */
const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;

/**
 * Partner deep links with dates pre-filled. Nothing is booked by TripAI.
 * A booking link is only ever for the trip's own dates: a fare or stay that was priced for OTHER dates
 * (or a city average) is never linked as such. For an estimated flight we link a search for the
 * exact dates instead ("Check prices for these dates"); an estimated stay is covered by the dated
 * Booking.com search above it.
 */
export function handoffLinks(
  rec: Recommendation,
  fallbackOrigin?: string,
  labels: { flights: string; hotels: string; checkPrices: string } = {
    flights: "Flights on Google Flights",
    hotels: "Hotels on Booking.com",
    checkPrices: "Check prices for these dates",
  },
): { label: string; url: string }[] {
  const { start, end } = rec.window;
  const origin = originOf(rec, fallbackOrigin);
  const adults = Math.max(1, Math.min(9, rec.travelers ?? 1));
  // A fare/stay page is linked only when the whole trip is priced for its own dates: a calendar fare
  // for other dates can carry no tell-tale words in its label ("…(Aviasales fare, not bookable)"), so
  // anything short of "exact" links a search for the exact dates instead.
  const money = moneyOf(rec);
  const exact = money.status === "exact";
  const exactLinks = exact
    ? rec.evidence
        .filter((e) => e.url && (e.kind === "flight" || e.kind === "hotel") && !estimatedLeg(e))
        .map((e) => ({ label: plainLabel(e.label), url: e.url! }))
    : [];
  // a search for the exact dates is right whenever any leg is uncertain (it never shows another date's fare)
  const needsSearch = !exact;
  return [
    {
      label: labels.flights,
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${origin} to ${rec.iata} on ${start} through ${end}`)}`,
    },
    {
      label: labels.hotels,
      url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(rec.city)}&checkin=${start}&checkout=${end}&group_adults=${adults}`,
    },
    ...(needsSearch
      ? [{ label: labels.checkPrices, url: `https://www.aviasales.com/search/${origin}${ddmm(start)}${rec.iata}${ddmm(end)}${adults}` }]
      : []),
    ...exactLinks,
  ];
}
