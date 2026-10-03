import { plural, type Shape } from "../types";

// Namespace "confirm": approve-before-booking step, partner hand-off and the calendar hold.
export const en = {
  trips: "Trips",
  loading: "Loading your trip…",
  notFound: "Trip not found. Back to trips.",
  nights: (n: number) => `${n} ${n === 1 ? "night" : "nights"}`,
  flight: (origin: string, iata: string) => `Flight ${origin}–${iata}`,
  hotelNights: (nights: string) => `Hotel, ${nights}`,
  /** tag next to a quoted amount */
  nothingBooked: "Nothing is booked yet",
  disclaimer: "You book on the partner site. Prices may change.",
  cachedTip: "Prices are cached quotes, not bookable fares. They are re-checked before hand-off.",
  understand: "I’ll confirm the final price myself.",
  approve: "Approve this plan",
  notNow: "Not now",
  approved: "Approved by you",
  bookHere: "Book at these links. Check the final price there before you pay.",
  holdDates: "Hold the dates in my calendar (tentative)",
  affiliate: "Affiliate links may earn TripAI a commission. That never changes the ranking.",
  backFromTrip: "Back from a trip? Tell us how it went →",
  icsSummary: (city: string) => `${city} trip (TripAI, tentative)`,
  icsDescription: (amount: string) => `Estimated ${amount} all-in. Not booked yet.`,
} as const;

export const pl: Shape<typeof en> = {
  trips: "Wyjazdy",
  loading: "Ładowanie wyjazdu…",
  notFound: "Nie znaleziono wyjazdu. Wróć do listy.",
  nights: (n) => `${n} ${plural("pl", n, { one: "noc", few: "noce", many: "nocy", other: "nocy" })}`,
  flight: (origin, iata) => `Lot ${origin}–${iata}`,
  hotelNights: (nights) => `Hotel, ${nights}`,
  nothingBooked: "Nic nie jest jeszcze zarezerwowane",
  disclaimer: "Rezerwujesz na stronie partnera. Ceny mogą się zmienić.",
  cachedTip: "Ceny to zapisane oferty, nie bilety do kupienia. Sprawdzamy je ponownie przed przekierowaniem.",
  understand: "Ostateczną cenę potwierdzę u partnera.",
  approve: "Zatwierdź ten plan",
  notNow: "Nie teraz",
  approved: "Zatwierdzone przez Ciebie",
  bookHere: "Zarezerwuj przez te linki. Przed zapłatą sprawdź tam ostateczną cenę.",
  holdDates: "Zablokuj daty w moim kalendarzu (wstępnie)",
  affiliate: "Linki partnerskie mogą przynieść TripAI prowizję. Nigdy nie wpływa to na ranking.",
  backFromTrip: "Już po wyjeździe? Opowiedz, jak było →",
  icsSummary: (city) => `Wyjazd: ${city} (TripAI, wstępnie)`,
  icsDescription: (amount) => `Szacunkowo ${amount} łącznie. Jeszcze niezarezerwowane.`,
};
