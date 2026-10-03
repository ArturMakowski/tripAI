import type { Shape } from "../types";

// Namespace "tutorial": first-run intro, coach marks and the "How it works" replay (T11).
// Budget (docs/DECLUTTER.md, enforced in lib/tutorial-store.test.ts): headlines ≤ 6 words, sublines and tips ≤ 10.
export const en = {
  dialogLabel: "How TripAI works",
  skip: "Skip",
  next: "Next",
  back: "Back",
  stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
  goToStep: (i: number) => `Go to step ${i}`,
  ctaDeck: "Start with Travel DNA",
  ctaDone: "Let’s go",
  howItWorks: "How it works",
  howItWorksSub: "Replay the 30-second tour",
  steps: {
    dna: {
      title: "Tell us how you travel",
      body: "14 Travel DNA cards · about a minute.",
    },
    calendar: {
      title: "We find when you’re free",
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
    thatsMe: "That’s me",
    notMe: "Not me",
    card: "I love discovering places I don’t know yet.",
    month: "May 2027",
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    bridge: "+1 day off → 4 days",
    source: "Google Flights · 07:42",
    fit: "Great fit",
    nights: "3 nights",
    approve: "Approve",
    notBooked: "Nothing is booked yet",
    alert: "Rome −18% · fits you",
    alertOnly: "Only when it’s worth it",
    cities: ["Rome", "Lisbon", "Athens"],
    example: "Example",
    /** label on every illustration: a still preview, not something to tap */
    preview: "Preview",
  },
  coach: {
    gotIt: "Got it",
    next: "Next",
    hide: "Hide tips",
    stepOf: (i: number, n: number) => `${i}/${n}`,
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
        body: "Tap for where each price came from, and when.",
      },
      flip: {
        title: "What would flip it?",
        body: "What would have to change for another trip to win.",
      },
      calendar: {
        title: "Mark your free days",
        body: "Tap a start, then an end. Dashed band = long weekend.",
      },
      scan: {
        title: "Run a scan now",
        body: "Like the daily 07:00 scan. Alerts only when worth it.",
      },
    },
  },
};

export const pl: Shape<typeof en> = {
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
  },
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
    preview: "Podgląd",
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
        body: "Dotknij: skąd jest każda cena i kiedy ją pobraliśmy.",
      },
      flip: {
        title: "Co by to zmieniło?",
        body: "Co musiałoby się zmienić, żeby wygrał inny kierunek.",
      },
      calendar: {
        title: "Zaznacz wolne dni",
        body: "Stuknij początek, potem koniec. Przerywana ramka = długi weekend.",
      },
      scan: {
        title: "Skanuj teraz",
        body: "Jak codzienny skan o 7:00. Alert tylko, gdy warto.",
      },
    },
  },
};
