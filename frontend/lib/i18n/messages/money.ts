import { plural, type Shape } from "../types";

/** Prices, party size and price honesty (docs/BUDGET.md), shared by cards, the receipt and confirm. */
export const en = {
  perPerson: "per person",
  perPersonShort: "/person",
  perRoom: "per room",
  perRoomShort: "/room",
  /** "2 people · 2,480 PLN total · 1,240 PLN/person" */
  party: (n: number, total: string, per: string) => `${n} ${plural("en", n, { one: "person", other: "people" })} · ${total} total · ${per}/person`,
  /** "from ~1,718 PLN (other dates)" */
  fromEstimate: (amount: string) => `from ~${amount} (other dates)`,
  estimateTitle: "Estimate, not this trip's price",
  estimateTip:
    "We couldn't price these exact dates. This comes from other dates or a city-average hotel, so it isn't used for ranking, budget or value badges.",
  partialTip: (leg: string) => `The ${leg} price is an estimate (other dates or city average); the rest is priced for your dates.`,
  legFlight: "flight",
  legHotel: "hotel",
  est: "est.",
  flight: (n: number) => (n > 1 ? `Flights × ${n}` : "Return flight"),
  hotel: (nights: string, rooms: number) => (rooms > 1 ? `Stay, ${nights} × ${rooms} rooms` : `Stay, ${nights}`),
  /** a specific priced hotel: "Hotel Raphael, 4 nights" */
  hotelNamed: (name: string, nights: string, rooms: number) => (rooms > 1 ? `${name}, ${nights} × ${rooms} rooms` : `${name}, ${nights}`),
  /** no specific hotel: the stay is a city average */
  cityAverage: "city average",
  total: (n: number) => (n > 1 ? `Total for ${n}` : "Total"),
  // party size
  people: "How many people?",
  fewer: "One person fewer",
  more: "One person more",
  peopleAria: (n: number) => `${n} ${plural("en", n, { one: "person", other: "people" })}`,
  // value badges
  valueGreat: "Great value",
  valueSplurge: (extra: string | null) => (extra ? `Worth the splurge ${extra}` : "Worth the splurge"),
  valueWhy: "Why this badge",
  // never-over limit (Profile)
  limitTitle: "Never show trips over…",
  limitOff: "Off",
  limitHint: "Optional. Without it we rank on value, not a cap.",
  limitAria: "Maximum price per person",
  /** the limit for the whole trip: "5,000 PLN per trip for 2" */
  limitPerTrip: (total: string, n: number) => `${total} per trip for ${n}`,
} as const;

const plPokoj = (n: number) => plural("pl", n, { one: "pokój", few: "pokoje", many: "pokoi", other: "pokoju" });

export const pl: Shape<typeof en> = {
  perPerson: "na osobę",
  perPersonShort: "/os.",
  perRoom: "za pokój",
  perRoomShort: "/pokój",
  party: (n, total, per) =>
    `${n} ${plural("pl", n, { one: "osoba", few: "osoby", many: "osób", other: "osoby" })} · ${total} razem · ${per}/os.`,
  fromEstimate: (amount) => `od ~${amount} (inne daty)`,
  estimateTitle: "Szacunek, nie cena tego wyjazdu",
  estimateTip:
    "Nie udało się wycenić tych dokładnych dat. Kwota pochodzi z innych terminów albo ze średniej hotelowej dla miasta, więc nie liczy się do rankingu, budżetu ani odznak.",
  partialTip: (leg) => `Cena (${leg}) to szacunek z innych dat lub średniej dla miasta; reszta jest wyceniona na Twoje daty.`,
  legFlight: "lot",
  legHotel: "nocleg",
  est: "szac.",
  flight: (n) => (n > 1 ? `Loty × ${n}` : "Lot w obie strony"),
  hotel: (nights, rooms) => (rooms > 1 ? `Nocleg, ${nights} × ${rooms} ${plPokoj(rooms)}` : `Nocleg, ${nights}`),
  hotelNamed: (name, nights, rooms) => (rooms > 1 ? `${name}, ${nights} × ${rooms} ${plPokoj(rooms)}` : `${name}, ${nights}`),
  cityAverage: "średnia w mieście",
  total: (n) => (n > 1 ? `Razem za ${n} os.` : "Razem"),
  people: "Ile osób?",
  fewer: "O jedną osobę mniej",
  more: "O jedną osobę więcej",
  peopleAria: (n) => `${n} ${plural("pl", n, { one: "osoba", few: "osoby", many: "osób", other: "osoby" })}`,
  valueGreat: "Świetna cena",
  valueSplurge: (extra) => (extra ? `Warto dopłacić ${extra}` : "Warto dopłacić"),
  valueWhy: "Skąd ta odznaka",
  limitPerTrip: (total, n) => `${total} za wyjazd (${n} os.)`,
  limitTitle: "Nie pokazuj wyjazdów droższych niż…",
  limitOff: "Wyłączone",
  limitHint: "Opcjonalnie. Bez limitu oceniamy wartość, a nie odcinamy.",
  limitAria: "Maksymalna cena na osobę",
};
