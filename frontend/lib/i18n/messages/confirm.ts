import { plural, type Shape } from "../types";

// Namespace "confirm": approve-before-booking step, partner hand-off and the calendar hold.
export const en = {
  trips: "Trips",
  loading: "Loading your trip…",
  notFound: "Trip not found. Back to trips.",
  nights: (n: number) => `${n} ${n === 1 ? "night" : "nights"}`,
  returnFlight: (origin: string, iata: string) => `Return flight ${origin} ⇄ ${iata}`,
  hotelNights: (nights: string) => `Hotel, ${nights}`,
  quoted: (amount: string) => `Quoted ${amount}`,
  nothingBooked: "Nothing is booked yet",
  notAgent:
    "TripAI is not a travel agent. When you approve, we open the partner sites with your dates filled in. You book and pay there, and prices may have changed since we checked.",
  understand: "I understand these are estimates and I’ll confirm the final price myself.",
  approve: "Approve this plan",
  notNow: "Not now. Keep watching for me.",
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
  returnFlight: (origin, iata) => `Lot w obie strony ${origin} ⇄ ${iata}`,
  hotelNights: (nights) => `Hotel, ${nights}`,
  quoted: (amount) => `Wycena ${amount}`,
  nothingBooked: "Nic nie jest jeszcze zarezerwowane",
  notAgent:
    "TripAI nie jest biurem podróży. Po zatwierdzeniu otworzymy strony partnerów z wpisanymi datami. Rezerwujesz i płacisz tam, a ceny mogły się zmienić od naszego sprawdzenia.",
  understand: "Rozumiem, że to szacunki, a ostateczną cenę potwierdzę u partnera.",
  approve: "Zatwierdź ten plan",
  notNow: "Nie teraz. Obserwuj dalej.",
  approved: "Zatwierdzone przez Ciebie",
  bookHere: "Zarezerwuj przez te linki. Przed zapłatą sprawdź tam ostateczną cenę.",
  holdDates: "Zablokuj daty w moim kalendarzu (wstępnie)",
  affiliate: "Linki partnerskie mogą przynieść TripAI prowizję. Nigdy nie wpływa to na ranking.",
  backFromTrip: "Już po wyjeździe? Opowiedz, jak było →",
  icsSummary: (city) => `Wyjazd: ${city} (TripAI, wstępnie)`,
  icsDescription: (amount) => `Szacunkowo ${amount} łącznie. Jeszcze niezarezerwowane.`,
};
