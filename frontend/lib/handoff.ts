import type { Recommendation } from "./types";

/** Departure airport the scorer actually priced (from the flight evidence), else the profile's first. */
export function originOf(rec: Recommendation, fallback = "KRK"): string {
  const label = rec.evidence.find((e) => e.kind === "flight")?.label ?? "";
  return label.match(/\b([A-Z]{3})[-–]([A-Z]{3})\b/)?.[1] ?? fallback;
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
    .map((e) => ({ label: e.label, url: e.url! }));
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
