import { plural, type Shape } from "../types";

const plTrips = (n: number) => `${n} ${plural("pl", n, { one: "wyjazd", few: "wyjazdy", many: "wyjazdów", other: "wyjazdu" })}`;

export const en = {
  title: "Where & when, ranked.",

  /** Shared factor names (also used by the receipt). */
  factors: { price: "Price", weather: "Weather", crowds: "Crowds", taste: "Taste fit" },
  factorsShort: { price: "Price", weather: "Weather", crowds: "Crowds", taste: "Taste" },

  slider: {
    question: "What matters most?",
    setByProfile: "From your profile",
    weights: "Weights",
    aria: "Priority between price, comfort and experience",
    price: "Price",
    comfort: "Comfort",
    experience: "Experience",
  },

  budget: {
    label: "Budget",
    none: "No budget limit",
    editAria: "Change budget in your profile",
    noneFitTitle: (budget: string) => `Nothing fits ${budget} here.`,
    noneFitBody: (city: string, price: string, over: string) => `Cheapest: ${city}, ${price} (+${over})`,
    listedUnder: "in",
    topOverTitle: (over: string) => `#1 is ${over} over budget.`,
    fitsHidden: (n: number) => `${n} that fit${n > 1 ? "" : "s"}:`,
    topOverBody: (n: number) => `${n} trip${n > 1 ? "s" : ""} fit${n > 1 ? "" : "s"}.`,
    showThoseFirst: "Show first",
    withinFirst: "Showing trips within your budget first",
    backToRanking: "Back to ranking",
  },

  filter: { showingOnly: (range: string) => `Showing ${range} only`, showAll: "Show all" },

  sameDates: {
    otherDates: "other dates",
    fixtureNote: "Demo data only prices a few dates, so the top picks share them. Live data spreads them across your free windows.",
  },

  loader: {
    title: "Finding trips for your free time",
    foundWindows: (n: number) => `Found ${n} ${plural("en", n, { one: "free window or long weekend", other: "free windows and long weekends" })}`,
    findingWindows: "Finding your free windows",
    scanning: (origin: string) => `Scanning destinations from ${origin}`,
    flightsHotels: "Checking flight and hotel prices",
    weatherRanking: "Weather, crowds and ranking for your Travel DNA",
    cachedFlights: "Checking cached flight prices",
    upNext: "live flight prices, hotels, weather, then ranking for your Travel DNA",
    next: "Next:",
  },

  refining: {
    titleLive: "Refining live prices…",
    titleDemo: "Refining prices (demo)…",
    landedLive: "Live prices in",
    landedDemo: "Exact demo prices in",
  },

  announce: {
    loading: "Finding trips for you.",
    refining: "Showing cached prices. Refining live prices.",
    landedLive: "Live prices in. Ranking updated.",
    landedDemo: "Demo prices updated. Ranking updated.",
  },

  push: {
    now: "· now",
    dismiss: "Dismiss",
    title: (range: string, city: string) => `You’re free ${range} → ${city}`,
    /** score = the ring's plain 0–100 number */
    body: (total: string, flights: string, score: number) => `${total} all-in · flights ${flights} · score ${score}`,
  },

  notYourStyle: "Not your style",
  notYourStyleCount: (n: number) => `${n} trip${n > 1 ? "s" : ""}`,
  hide: "hide",
  showAnyway: "show anyway",
  empty: "No trips fit this window yet. We’ll keep watching.",
  neverPaid: "No paid rankings.",

  card: {
    bridge: (off: number, total: number) => `${off}d off → ${total}d`,
    nights: (n: number) => `${n} ${plural("en", n, { one: "night", other: "nights" })}`,
    allIn: "all-in",
    cachedEstimate: "estimate",
    overBudget: (amount: string) => `Over budget +${amount}`,
    disagree: "Score and fit disagree:",
  },
} as const;

export const pl: Shape<typeof en> = {
  title: "Dokąd i kiedy: ranking.",

  factors: { price: "Cena", weather: "Pogoda", crowds: "Tłumy", taste: "Dopasowanie do gustu" },
  factorsShort: { price: "Cena", weather: "Pogoda", crowds: "Tłumy", taste: "Gust" },

  slider: {
    question: "Co najważniejsze?",
    setByProfile: "Z Twojego profilu",
    weights: "Wagi",
    aria: "Priorytet między ceną, komfortem i przeżyciami",
    price: "Cena",
    comfort: "Komfort",
    experience: "Przeżycia",
  },

  budget: {
    label: "Budżet",
    none: "Bez limitu budżetu",
    editAria: "Zmień budżet w profilu",
    noneFitTitle: (budget: string) => `Nic do ${budget} w tych terminach.`,
    noneFitBody: (city: string, price: string, over: string) => `Najtaniej: ${city}, ${price} (+${over})`,
    listedUnder: "w sekcji",
    topOverTitle: (over: string) => `Nr 1 jest ${over} ponad budżet.`,
    fitsHidden: (n: number) => `W budżecie: ${plTrips(n)}, w sekcji`,
    topOverBody: (n: number) => `W budżecie: ${plTrips(n)}.`,
    showThoseFirst: "Pokaż najpierw",
    withinFirst: "Najpierw wyjazdy mieszczące się w budżecie",
    backToRanking: "Wróć do rankingu",
  },

  filter: { showingOnly: (range: string) => `Tylko ${range}`, showAll: "Pokaż wszystko" },

  sameDates: {
    otherDates: "inne terminy",
    fixtureNote: "Dane demo wyceniają tylko kilka dat, więc najlepsze propozycje mają ten sam termin. Dane na żywo rozłożą je na Twoje wolne terminy.",
  },

  loader: {
    title: "Szukamy wyjazdów na Twój wolny czas",
    foundWindows: (n: number) =>
      `Znaleziono ${n} ${plural("pl", n, { one: "wolny termin", few: "wolne terminy", many: "wolnych terminów", other: "wolnego terminu" })} i długie weekendy`,
    findingWindows: "Szukamy Twoich wolnych terminów",
    scanning: (origin: string) => `Przeglądamy kierunki z ${origin}`,
    flightsHotels: "Sprawdzamy ceny lotów i hoteli",
    weatherRanking: "Pogoda, tłumy i ranking pod Twoje DNA podróżnika",
    cachedFlights: "Sprawdzamy zapisane ceny lotów",
    upNext: "ceny lotów na żywo, hotele, pogoda, a potem ranking pod Twoje DNA podróżnika",
    next: "Dalej:",
  },

  refining: {
    titleLive: "Doprecyzowujemy ceny na żywo…",
    titleDemo: "Doprecyzowujemy ceny (demo)…",
    landedLive: "Ceny na żywo gotowe",
    landedDemo: "Dokładne ceny demo gotowe",
  },

  announce: {
    loading: "Szukamy dla Ciebie wyjazdów.",
    refining: "Pokazujemy zapisane ceny. Doprecyzowujemy ceny na żywo.",
    landedLive: "Ceny na żywo gotowe. Ranking zaktualizowany.",
    landedDemo: "Ceny demo zaktualizowane. Ranking zaktualizowany.",
  },

  push: {
    now: "· teraz",
    dismiss: "Zamknij",
    title: (range: string, city: string) => `Masz wolne ${range} → ${city}`,
    body: (total: string, flights: string, score: number) =>
      `${total} łącznie · loty ${flights} · wynik ${score}`,
  },

  notYourStyle: "Nie w Twoim stylu",
  notYourStyleCount: (n: number) => plTrips(n),
  hide: "ukryj",
  showAnyway: "pokaż mimo to",
  empty: "Na ten termin nic jeszcze nie pasuje. Będziemy dalej szukać.",
  neverPaid: "Bez płatnych miejsc w rankingu.",

  card: {
    bridge: (off: number, total: number) =>
      `${off} ${plural("pl", off, { one: "dzień", few: "dni", many: "dni", other: "dnia" })} urlopu → ${total} ${plural("pl", total, { one: "dzień", few: "dni", many: "dni", other: "dnia" })}`,
    nights: (n: number) => `${n} ${plural("pl", n, { one: "noc", few: "noce", many: "nocy", other: "nocy" })}`,
    allIn: "łącznie",
    cachedEstimate: "szacunek",
    overBudget: (amount: string) => `Ponad budżet +${amount}`,
    disagree: "Wynik i dopasowanie się różnią:",
  },
};
