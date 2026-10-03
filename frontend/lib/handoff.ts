import type { Recommendation } from "./types";

/** Partner deep links with dates pre-filled. Nothing is booked by TripAI. */
export function handoffLinks(rec: Recommendation): { label: string; url: string }[] {
  const { start, end } = rec.window;
  const evidenceLinks = rec.evidence
    .filter((e) => e.url && (e.kind === "flight" || e.kind === "hotel"))
    .map((e) => ({ label: e.label, url: e.url! }));
  return [
    {
      label: "Flights on Google Flights",
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from KRK to ${rec.iata} on ${start} through ${end}`)}`,
    },
    {
      label: "Hotels on Booking.com",
      url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(rec.city)}&checkin=${start}&checkout=${end}&group_adults=1`,
    },
    ...evidenceLinks,
  ];
}
