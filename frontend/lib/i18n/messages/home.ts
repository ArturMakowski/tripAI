import type { Shape } from "../types";

export const en = {
  photos: { lisbon: "Alfama rooftops in Lisbon", rome: "Colosseum in Rome", athens: "Acropolis in Athens" },
  example: "Free 14–19 Jan → Rome",
  title: "Tell us when you’re free.",
  /** "We'll pick <where> and <when> to go, and show why." */
  lead: { before: "We’ll pick ", where: "where", and: " and ", when: "when", after: " to go, with proof." },
  /** Trust promises as chips; the details live on the receipt. */
  promises: { sources: "Sourced prices", formula: "Transparent score", noBooking: "You book" },
  seeTrips: "See your trips",
  startOver: "Start over",
  swipe: "Start planning",
  chatInstead: "Chat instead",
  demoProfile: "Use demo profile",
} as const;

export const pl: Shape<typeof en> = {
  photos: { lisbon: "Dachy Alfamy w Lizbonie", rome: "Koloseum w Rzymie", athens: "Akropol w Atenach" },
  example: "Wolne 14–19 sty → Rzym",
  title: "Powiedz, kiedy masz wolne.",
  lead: { before: "Podpowiemy, ", where: "dokąd", and: " i ", when: "kiedy", after: " jechać — z dowodami." },
  promises: { sources: "Ceny ze źródłem", formula: "Jawny wynik", noBooking: "Ty rezerwujesz" },
  seeTrips: "Zobacz swoje wyjazdy",
  startOver: "Zacznij od nowa",
  swipe: "Zacznij planować",
  chatInstead: "Porozmawiaj z TripAI",
  demoProfile: "Profil demo",
};
