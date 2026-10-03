import { plural, type Shape } from "../types";

const plTrips = (n: number) => `${n} ${plural("pl", n, { one: "wyjazd", few: "wyjazdy", many: "wyjazdów", other: "wyjazdu" })}`;

export const en = {
  eyebrow: "Picked for your free time",
  title: "Where & when, ranked.",
  intro: "Every score is a weighted sum of four sourced factors. Move the slider and the ranking updates as you drag.",

  /** Shared factor names (also used by the receipt). */
  factors: { price: "Price", weather: "Weather", crowds: "Crowds", taste: "Taste fit" },
  factorsShort: { price: "Price", weather: "Weather", crowds: "Crowds", taste: "Taste" },

  slider: {
    question: "What matters most this time?",
    setByProfile: "Set by your profile",
    aria: "Priority between price, comfort and experience",
    price: "Price",
    comfort: "Comfort",
    experience: "Experience",
  },

  budget: {
    label: "Budget",
    none: "No budget limit",
    setInProfile: "set in profile",
    setOne: "set one",
    noneFitTitle: (budget: string) => `Nothing fits ${budget} for these dates.`,
    noneFitBody: (city: string, price: string, over: string) =>
      `These are the closest options, still ranked by score. The cheapest is ${city} at ${price} (+${over})`,
    listedUnder: "listed under",
    topOverTitle: (over: string, budget: string) => `Your top pick is ${over} over your ${budget} budget.`,
    fitsHidden: (n: number) => `${n} trip${n > 1 ? "s" : ""} that fit${n > 1 ? "" : "s"} it ${n > 1 ? "are" : "is"} listed under`,
    topOverBody: (n: number) => `It ranks first on the other factors. ${n} trip${n > 1 ? "s" : ""} fit${n > 1 ? "" : "s"} your budget.`,
    showThoseFirst: "Show those first",
    withinFirst: "Showing trips within your budget first",
    backToRanking: "Back to ranking",
  },

  filter: { showingOnly: (range: string) => `Showing ${range} only`, showAll: "Show all" },

  sameDates: {
    fixturePre: "Your top picks all share",
    fixturePost: "because the demo data only prices a few dates. With live data they spread across all your free windows.",
    livePre: "Your top picks all fall on",
    livePost: ", the best of your free windows right now. The others are on",
    freeTime: "Free time",
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
    titleDemo: "Refining prices (demo data)…",
    detail: "Exact flights, hotels and weather, then ranking for your Travel DNA",
    tag: "cached prices shown",
    landedLive: "Live prices in. Ranking updated.",
    landedDemo: "Exact demo prices in. Ranking updated.",
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
    body: (total: string, flights: string, score: string) => `${total} all-in · flights ${flights} · ★ ${score}/5. Tap to see why.`,
  },

  notYourStyle: "Not your style",
  notYourStyleCount: (n: number) => `${n} trip${n > 1 ? "s" : ""}`,
  hide: "hide",
  showAnyway: "show anyway",
  empty: "No trips fit this window yet. We’ll keep watching.",
  neverPaid: "Rankings are never paid for. Sponsored offers, if we ever show any, will be labelled separately.",

  card: {
    youreFree: "You’re free",
    bridge: (off: number, total: number) => `${off}d off → ${total}d`,
    when: "When",
    nights: (n: number) => `${n} ${plural("en", n, { one: "night", other: "nights" })}`,
    allIn: "All-in, per person",
    cachedEstimate: "Cached estimate",
    overBudget: (amount: string) => `Over budget +${amount}`,
    vsPeak: (pct: number) => `−${pct}% vs peak season`,
    peakNote: (month: string | null, peak: string, now: string, version: string) =>
      `Same trip${month ? ` in ${month}` : ""} (the city's peak-crowd month): ${peak} vs ${now} now · TripAI scorer ${version}`,
    disagree: "Score and fit disagree.",
    whyNow: "Why this, why now",
  },
} as const;

export const pl: Shape<typeof en> = {
  eyebrow: "Wybrane na Twój wolny czas",
  title: "Dokąd i kiedy: ranking.",
  intro: "Każdy wynik to ważona suma czterech czynników ze źródłami. Przesuń suwak, a ranking zmienia się na bieżąco.",

  factors: { price: "Cena", weather: "Pogoda", crowds: "Tłumy", taste: "Dopasowanie do gustu" },
  factorsShort: { price: "Cena", weather: "Pogoda", crowds: "Tłumy", taste: "Gust" },

  slider: {
    question: "Co jest tym razem najważniejsze?",
    setByProfile: "Ustawione z Twojego profilu",
    aria: "Priorytet między ceną, komfortem i przeżyciami",
    price: "Cena",
    comfort: "Komfort",
    experience: "Przeżycia",
  },

  budget: {
    label: "Budżet",
    none: "Bez limitu budżetu",
    setInProfile: "ustawiony w profilu",
    setOne: "ustaw go",
    noneFitTitle: (budget: string) => `Nic nie mieści się w ${budget} w tych terminach.`,
    noneFitBody: (city: string, price: string, over: string) =>
      `To najbliższe opcje, nadal uszeregowane według wyniku. Najtańsza: ${city} za ${price} (+${over})`,
    listedUnder: "w sekcji",
    topOverTitle: (over: string, budget: string) => `Twój pierwszy wybór przekracza budżet ${budget} o ${over}.`,
    fitsHidden: (n: number) =>
      `${plTrips(n)} w budżecie ${plural("pl", n, { one: "jest", few: "są", many: "jest", other: "jest" })} w sekcji`,
    topOverBody: (n: number) =>
      `Wygrywa na pozostałych czynnikach. W budżecie ${plural("pl", n, { one: "mieści się", few: "mieszczą się", many: "mieści się", other: "mieści się" })} ${plTrips(n)}.`,
    showThoseFirst: "Pokaż je najpierw",
    withinFirst: "Najpierw wyjazdy mieszczące się w budżecie",
    backToRanking: "Wróć do rankingu",
  },

  filter: { showingOnly: (range: string) => `Tylko ${range}`, showAll: "Pokaż wszystko" },

  sameDates: {
    fixturePre: "Wszystkie najlepsze propozycje mają termin",
    fixturePost: "bo dane demo wyceniają tylko kilka dat. Z danymi na żywo rozłożą się na wszystkie Twoje wolne terminy.",
    livePre: "Wszystkie najlepsze propozycje wypadają",
    livePost: ", w najlepszym z Twoich wolnych terminów. Pozostałe znajdziesz w zakładce",
    freeTime: "Wolny czas",
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
    titleDemo: "Doprecyzowujemy ceny (dane demo)…",
    detail: "Dokładne loty, hotele i pogoda, a potem ranking pod Twoje DNA podróżnika",
    tag: "widać zapisane ceny",
    landedLive: "Ceny na żywo gotowe. Ranking zaktualizowany.",
    landedDemo: "Dokładne ceny demo gotowe. Ranking zaktualizowany.",
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
    body: (total: string, flights: string, score: string) =>
      `${total} łącznie · loty ${flights} · ★ ${score}/5. Dotknij, aby zobaczyć dlaczego.`,
  },

  notYourStyle: "Nie w Twoim stylu",
  notYourStyleCount: (n: number) => plTrips(n),
  hide: "ukryj",
  showAnyway: "pokaż mimo to",
  empty: "Na ten termin nic jeszcze nie pasuje. Będziemy dalej szukać.",
  neverPaid: "Za miejsce w rankingu nikt nie płaci. Oferty sponsorowane, jeśli kiedyś się pojawią, będą osobno oznaczone.",

  card: {
    youreFree: "Masz wolne",
    bridge: (off: number, total: number) =>
      `${off} ${plural("pl", off, { one: "dzień", few: "dni", many: "dni", other: "dnia" })} urlopu → ${total} ${plural("pl", total, { one: "dzień", few: "dni", many: "dni", other: "dnia" })}`,
    when: "Kiedy",
    nights: (n: number) => `${n} ${plural("pl", n, { one: "noc", few: "noce", many: "nocy", other: "nocy" })}`,
    allIn: "Łącznie, za osobę",
    cachedEstimate: "Zapisana szacunkowa cena",
    overBudget: (amount: string) => `Ponad budżet +${amount}`,
    vsPeak: (pct: number) => `−${pct}% względem szczytu sezonu`,
    peakNote: (month: string | null, peak: string, now: string, version: string) =>
      `Ten sam wyjazd w szczycie sezonu w tym mieście${month ? ` (${month})` : ""}: ${peak} wobec ${now} teraz · algorytm TripAI ${version}`,
    disagree: "Wynik i dopasowanie się różnią.",
    whyNow: "Dlaczego to i dlaczego teraz",
  },
};
