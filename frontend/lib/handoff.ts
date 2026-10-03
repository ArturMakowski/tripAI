import { plainLabel } from "./evidence-display";
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

/** Partner deep links with dates pre-filled. Nothing is booked by TripAI. */
export function handoffLinks(
  rec: Recommendation,
  fallbackOrigin?: string,
  labels: { flights: string; hotels: string } = { flights: "Flights on Google Flights", hotels: "Hotels on Booking.com" },
): { label: string; url: string }[] {
  const { start, end } = rec.window;
  const origin = originOf(rec, fallbackOrigin);
  const evidenceLinks = rec.evidence
    .filter((e) => e.url && (e.kind === "flight" || e.kind === "hotel"))
    .map((e) => ({ label: plainLabel(e.label), url: e.url! })); // no data-layer jargon in link text
  return [
    {
      label: labels.flights,
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${origin} to ${rec.iata} on ${start} through ${end}`)}`,
    },
    {
      label: labels.hotels,
      url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(rec.city)}&checkin=${start}&checkout=${end}&group_adults=1`,
    },
    ...evidenceLinks,
  ];
}
