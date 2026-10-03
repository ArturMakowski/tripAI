/**
 * Tutorial copy, PL + EN. One const object until the app-wide i18n dictionaries land (PR #22),
 * then this moves to `lib/i18n/messages/tutorial.ts` unchanged.
 */
import type { TourKey } from "@/lib/tutorial-store";

export type TutorialLang = "pl" | "en";

export type IntroStepId = "dna" | "calendar" | "proof" | "decide";

/** Every coach mark targets an element carrying `data-tour="<anchor>"` (the first visible one). */
export const TOURS: Record<TourKey, { anchor: string }[]> = {
  trips: [{ anchor: "slider" }, { anchor: "fit" }, { anchor: "swipe-toggle" }],
  receipt: [{ anchor: "source" }, { anchor: "flip" }],
  windows: [{ anchor: "calendar" }],
  inbox: [{ anchor: "scan" }],
};

const pl = {
  dialogLabel: "Jak działa TripAI",
  skip: "Pomiń",
  next: "Dalej",
  back: "Wstecz",
  stepOf: (i: number, n: number) => `Krok ${i} z ${n}`,
  goToStep: (i: number) => `Przejdź do kroku ${i}`,
  ctaDeck: "Zacznij od Travel DNA",
  ctaDone: "Zaczynamy",
  howItWorks: "Jak to działa?",
  howItWorksSub: "Obejrzyj samouczek jeszcze raz (30 s)",
  steps: {
    dna: {
      title: "Powiedz nam, jak lubisz podróżować",
      body: "14 kart Travel DNA · około minuty.",
    },
    calendar: {
      title: "Znajdziemy, kiedy masz wolne",
      body: "Kalendarz + radar długich weekendów.",
    },
    proof: {
      title: "Pokażemy gdzie i kiedy, z dowodami",
      body: "Cena all-in · źródło każdej liczby · ocena AI.",
    },
    decide: {
      title: "Ty decydujesz",
      body: "Nic nie rezerwujemy bez Ciebie. Alerty tylko, gdy warto.",
    },
  } satisfies Record<IntroStepId, { title: string; body: string }>,
  art: {
    thatsMe: "To ja",
    notMe: "Nie ja",
    card: "Lubię odkrywać miejsca, których jeszcze nie znam.",
    month: "Maj 2027",
    weekdays: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
    bridge: "+1 dzień urlopu → 4 dni",
    source: "Google Flights · 07:42",
    fit: "Pasuje do Ciebie",
    nights: "3 noce",
    approve: "Zatwierdź",
    notBooked: "Nic nie jest zarezerwowane",
    alert: "Rzym −18% · pasuje do Ciebie",
    alertOnly: "Tylko gdy warto",
    cities: ["Rzym", "Lizbona", "Ateny"],
    example: "Przykład",
  },
  coach: {
    gotIt: "Rozumiem",
    next: "Dalej",
    hide: "Ukryj wskazówki",
    stepOf: (i: number, n: number) => `${i}/${n}`,
    marks: {
      slider: {
        title: "Co jest teraz najważniejsze?",
        body: "Cena ↔ komfort ↔ przeżycia. Ranking zmienia się od razu.",
      },
      fit: {
        title: "Ocena dopasowania AI",
        body: "Czy pasuje do Twojego DNA. Liczby liczy algorytm, nie AI.",
      },
      "swipe-toggle": {
        title: "Lista albo swipe",
        body: "Przesuwaj oferty. Każdy ruch uczy Twój gust.",
      },
      source: {
        title: "Każda liczba ma źródło",
        body: "Skąd jest cena i kiedy ją pobraliśmy.",
      },
      flip: {
        title: "Co by to zmieniło?",
        body: "Co musiałoby się zmienić, żeby wygrał inny kierunek.",
      },
      calendar: {
        title: "Zaznacz wolne dni",
        body: "Stuknij początek, potem koniec. Słońce = długi weekend.",
      },
      scan: {
        title: "Skanuj teraz",
        body: "Jak codzienny skan o 7:00. Alert tylko, gdy warto.",
      },
    } as Record<string, { title: string; body: string }>,
  },
};

type Copy = typeof pl;

const en: Copy = {
  dialogLabel: "How TripAI works",
  skip: "Skip",
  next: "Next",
  back: "Back",
  stepOf: (i, n) => `Step ${i} of ${n}`,
  goToStep: (i) => `Go to step ${i}`,
  ctaDeck: "Start with Travel DNA",
  ctaDone: "Let's go",
  howItWorks: "How it works",
  howItWorksSub: "Replay the 30-second tour",
  steps: {
    dna: {
      title: "Tell us how you travel",
      body: "14 Travel DNA cards · about a minute.",
    },
    calendar: {
      title: "We find when you're free",
      body: "Your calendar + a long-weekend radar.",
    },
    proof: {
      title: "Where and when, with proof",
      body: "All-in price · a source for every number · AI fit check.",
    },
    decide: {
      title: "You decide",
      body: "Nothing booked without you. Alerts only when worth it.",
    },
  },
  art: {
    thatsMe: "That's me",
    notMe: "Not me",
    card: "I love discovering places I don't know yet.",
    month: "May 2027",
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    bridge: "+1 day off → 4 days",
    source: "Google Flights · 07:42",
    fit: "Great fit",
    nights: "3 nights",
    approve: "Approve",
    notBooked: "Nothing is booked yet",
    alert: "Rome −18% · fits you",
    alertOnly: "Only when it's worth it",
    cities: ["Rome", "Lisbon", "Athens"],
    example: "Example",
  },
  coach: {
    gotIt: "Got it",
    next: "Next",
    hide: "Hide tips",
    stepOf: (i, n) => `${i}/${n}`,
    marks: {
      slider: {
        title: "What matters most?",
        body: "Price ↔ comfort ↔ experience. The ranking updates instantly.",
      },
      fit: {
        title: "AI fit check",
        body: "Does it suit your DNA? The scorer does the numbers.",
      },
      "swipe-toggle": {
        title: "List or swipe",
        body: "Swipe offers. Every swipe teaches it your taste.",
      },
      source: {
        title: "Every number has a source",
        body: "Where the price came from, and when.",
      },
      flip: {
        title: "What would flip it?",
        body: "What would have to change for another trip to win.",
      },
      calendar: {
        title: "Mark your free days",
        body: "Tap a start, then an end. Sun = long weekend.",
      },
      scan: {
        title: "Run a scan now",
        body: "Like the daily 07:00 scan. Alerts only when worth it.",
      },
    },
  },
};

export const TUTORIAL_COPY: Record<TutorialLang, Copy> = { pl, en };
export const INTRO_STEPS: IntroStepId[] = ["dna", "calendar", "proof", "decide"];
