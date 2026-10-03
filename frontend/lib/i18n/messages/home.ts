import { plural, type Shape } from "../types";

export const en = {
  photos: { lisbon: "Alfama rooftops in Lisbon", rome: "Colosseum in Rome", athens: "Acropolis in Athens" },
  title: "Tell us when you’re free.",
  /** "We'll pick <where> and <when> to go, with proof." */
  lead: { before: "We’ll pick ", where: "where", and: " and ", when: "when", after: " to go, with proof." },
  /** Trust promises as chips; the details live on the receipt. */
  promises: { sources: "Sourced prices", formula: "Transparent score", noBooking: "You book" },
  seeTrips: "See your trips",
  startOver: "Start over",
  swipe: "Let’s go",
  chatInstead: "Chat instead",
  demoProfile: "Use demo profile",
  /** the returning user's "today" summary (T16) */
  today: {
    label: "Today",
    top: "Your #1 right now",
    checked: (ago: string) => `checked ${ago}`,
    free: "Next time off",
    yourDates: "Your dates",
    longWeekend: "Long weekend",
    myTrips: "My trips",
    inbox: "Inbox",
    unread: (n: number) => `${n} new`,
  },
} as const;

export const pl: Shape<typeof en> = {
  photos: { lisbon: "Dachy Alfamy w Lizbonie", rome: "Koloseum w Rzymie", athens: "Akropol w Atenach" },
  title: "Powiedz, kiedy masz wolne.",
  lead: { before: "Podpowiemy, ", where: "dokąd", and: " i ", when: "kiedy", after: " jechać — z dowodami." },
  promises: { sources: "Ceny ze źródłem", formula: "Jawny wynik", noBooking: "Ty rezerwujesz" },
  seeTrips: "Zobacz swoje wyjazdy",
  startOver: "Zacznij od nowa",
  swipe: "Zaczynamy",
  chatInstead: "Porozmawiaj z TripAI",
  demoProfile: "Profil demo",
  today: {
    label: "Dziś",
    top: "Twój nr 1 teraz",
    checked: (ago) => `sprawdzone ${ago}`,
    free: "Najbliższe wolne",
    yourDates: "Twoje terminy",
    longWeekend: "Długi weekend",
    myTrips: "Moje podróże",
    inbox: "Powiadomienia",
    unread: (n) => `${n} ${plural("pl", n, { one: "nowe", few: "nowe", many: "nowych", other: "nowych" })}`,
  },
};
