import type { Shape } from "../types";

export const en = {
  photos: { lisbon: "Alfama rooftops in Lisbon", rome: "Colosseum in Rome", athens: "Acropolis in Athens" },
  example: "e.g. “You’re free 14–19 Jan → Rome”",
  title: "Tell us who you are and when you’re free.",
  /** "We'll tell you <where> and <when> to go, and show how we got there." */
  lead: { before: "We’ll tell you ", where: "where", and: " and ", when: "when", after: " to go, and show how we got there." },
  promises: {
    sources: "Every price and fact shows its source and when it was fetched.",
    formula: "A transparent scoring formula ranks your options. The AI explains, it doesn't decide.",
    noBooking: "Nothing gets booked until you say so.",
  },
  seeTrips: "See your trips",
  startOver: "Start over",
  swipe: "Swipe your Travel DNA",
  chatInstead: "or chat with TripAI instead",
  demoProfile: "Skip and use the demo profile",
} as const;

export const pl: Shape<typeof en> = {
  photos: { lisbon: "Dachy Alfamy w Lizbonie", rome: "Koloseum w Rzymie", athens: "Akropol w Atenach" },
  example: "np. „Masz wolne 14–19 sty → Rzym”",
  title: "Powiedz nam, kim jesteś i kiedy masz wolne.",
  lead: { before: "Podpowiemy, ", where: "dokąd", and: " i ", when: "kiedy", after: " pojechać, i pokażemy, skąd to wiemy." },
  promises: {
    sources: "Każda cena i każdy fakt mają źródło i czas pobrania.",
    formula: "Opcje układa przejrzysty wzór punktacji. AI tłumaczy, ale nie decyduje.",
    noBooking: "Nic nie zostanie zarezerwowane bez Twojej zgody.",
  },
  seeTrips: "Zobacz swoje wyjazdy",
  startOver: "Zacznij od nowa",
  swipe: "Odkryj swoje DNA podróżnika",
  chatInstead: "albo porozmawiaj z TripAI",
  demoProfile: "Pomiń i użyj profilu demo",
};
