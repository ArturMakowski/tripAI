/**
 * Travel DNA swipe deck (docs/TRAVEL_DNA.md): 12 statements + 2 yes/no cards,
 * PL copy primary with EN toggle. This file only describes the cards and the
 * gesture -> answer mapping; the profile itself comes from POST /profile/dna.
 */

export type Lang = "pl" | "en";
export type CardId = `q${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}` | "y1" | "y2";
export type Gesture = "left" | "down" | "right" | "up";

export interface Credit {
  author: string;
  license: string;
  source: string;
}

export interface DnaCard {
  id: CardId;
  kind: "statement" | "yesno";
  text: Record<Lang, string>;
  /** short noun phrase for "because you swiped … on <short>" */
  short: Record<Lang, string>;
  image: string;
  credit: Credit;
}

const WM = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;
const UNSPLASH = (id: string): Credit => ({
  author: "Unsplash contributor",
  license: "Unsplash License",
  source: `https://images.unsplash.com/${id}`,
});

export const DNA_DECK: DnaCard[] = [
  {
    id: "q1",
    kind: "statement",
    text: { pl: "Lubię odkrywać miejsca, których jeszcze nie znam.", en: "I love discovering places I don't know yet." },
    short: { pl: "odkrywaniu nowych miejsc", en: "discovering new places" },
    image: "/swipe/explore.jpg",
    credit: { author: "Kalen Emsley / Unsplash", license: "CC0", source: "https://unsplash.com/photos/mgJSkgIo_JI" },
  },
  {
    id: "q2",
    kind: "statement",
    text: { pl: "Podczas podróży wolę mieć zaplanowany każdy dzień.", en: "I prefer every travel day to be planned." },
    short: { pl: "planowaniu każdego dnia", en: "planning every day" },
    image: "/swipe/plan.jpg",
    credit: { author: "Anna Goelet / Johan Nieuhof", license: "Public domain", source: WM("AMH-6926-KB_Map_of_the_Cape_of_Good_Hope.jpg") },
  },
  {
    id: "q3",
    kind: "statement",
    text: { pl: "Lubię spontanicznie zmieniać plany podczas podróży.", en: "I like changing plans spontaneously." },
    short: { pl: "spontanicznych zmianach planów", en: "changing plans spontaneously" },
    image: "/swipe/nightlife.jpg",
    credit: {
      author: "PattayaPatrol",
      license: "CC BY-SA 4.0",
      source: WM("DSCF0502_A_chilled_cocktail_on_the_bar_ice_clinking_and_neon_lights_blurring_into_a_colorful_night.jpg"),
    },
  },
  {
    id: "q4",
    kind: "statement",
    text: { pl: "Ważniejsze są dla mnie doświadczenia niż komfort.", en: "Experiences matter more to me than comfort." },
    short: { pl: "doświadczeniach ponad komfort", en: "experiences over comfort" },
    image: "/swipe/heat.jpg",
    credit: { author: "Mustang Joe", license: "CC0", source: WM("Climbing_the_Merzouga_Dunes.jpg") },
  },
  {
    id: "q5",
    kind: "statement",
    text: { pl: "Chętnie poznaję lokalną kuchnię i kulturę.", en: "I'm keen on local food and culture." },
    short: { pl: "lokalnej kuchni i kulturze", en: "local food and culture" },
    image: "/swipe/food.jpg",
    credit: { author: "Wilfredor", license: "CC BY-SA 4.0", source: WM("Municipal_Market_of_S%C3%A3o_Paulo_city.jpg") },
  },
  {
    id: "q6",
    kind: "statement",
    text: { pl: "Szukam przede wszystkim odpoczynku i relaksu.", en: "Above all I look for rest and relaxation." },
    short: { pl: "odpoczynku i relaksie", en: "rest and relaxation" },
    image: "/swipe/five-star.jpg",
    credit: { author: "Martin Falbisoner", license: "CC BY-SA 4.0", source: WM("Infinity_Edge_Pool,_Mauritius.JPG") },
  },
  {
    id: "q7",
    kind: "statement",
    text: { pl: "Lubię aktywnie spędzać czas (pieszo, rower, woda).", en: "I like being active (hiking, cycling, water)." },
    short: { pl: "aktywnym wypoczynku", en: "being active" },
    image: "/swipe/hiking.jpg",
    credit: { author: "BLM Oregon & Washington", license: "Public domain", source: WM("Hiking_Along_the_East_Applegate_Ridge_Trail_(40237270420).jpg") },
  },
  {
    id: "q8",
    kind: "statement",
    text: { pl: "Często wybieram miejsca mniej turystyczne.", en: "I often pick less touristy places." },
    short: { pl: "mniej turystycznych miejscach", en: "less touristy places" },
    image: "/swipe/beach.jpg",
    credit: {
      author: "dronepicr",
      license: "CC BY 2.0",
      source: WM("Turquoise_waters_of_the_Aegean_Sea_at_Hawaii_Beach_on_Naxos_Island,_Greece.jpg"),
    },
  },
  {
    id: "q9",
    kind: "statement",
    text: { pl: "Cena ma duży wpływ na wybór kierunku i atrakcji.", en: "Price strongly drives where I go and what I do." },
    short: { pl: "cenie jako głównym kryterium", en: "price driving your choices" },
    image: "/swipe/price.jpg",
    credit: { author: "Spielvogel", license: "CC BY-SA 3.0", source: WM("1984_in_Merida_station._Spielvogel_Archiv2.jpg") },
  },
  {
    id: "q10",
    kind: "statement",
    text: { pl: "Jestem skłonny zapłacić więcej za wyjątkowe doświadczenie.", en: "I'll pay more for a unique experience." },
    short: { pl: "dopłacaniu za wyjątkowe przeżycia", en: "paying more for something unique" },
    image: "/swipe/wine.jpg",
    credit: { author: "Aciarium", license: "CC BY 4.0", source: WM("DSC06590_Vineyard_at_Sunset,_Gumpoldskirchen,_2023-10.jpg") },
  },
  {
    id: "q11",
    kind: "statement",
    text: { pl: "Lubię podróżować z dala od tłumów.", en: "I like travelling away from crowds." },
    short: { pl: "podróżowaniu z dala od tłumów", en: "travelling away from crowds" },
    image: "/swipe/nature.jpg",
    credit: { author: "King of Hearts", license: "CC BY-SA 4.0", source: WM("Lake_Mary_Mammoth_September_2016.jpg") },
  },
  {
    id: "q12",
    kind: "statement",
    text: { pl: "Chętnie wracam do miejsc, które już znam.", en: "I happily return to places I know." },
    short: { pl: "powrotach do znanych miejsc", en: "returning to places you know" },
    image: "/cities/rome.jpg",
    credit: UNSPLASH("photo-1552832230-c0197dd311b5"),
  },
  {
    id: "y1",
    kind: "yesno",
    text: { pl: "Czy chcesz odkrywać nowe miejsca każdego dnia?", en: "Do you want to discover new places every day?" },
    short: { pl: "codziennym odkrywaniu", en: "discovering something new daily" },
    image: "/cities/lisbon.jpg",
    credit: UNSPLASH("photo-1585208798174-6cedd86e019a"),
  },
  {
    id: "y2",
    kind: "yesno",
    text: {
      pl: "Czy aplikacja ma dopasowywać rekomendacje do Twojego stylu?",
      en: "Should the app tailor recommendations to your style?",
    },
    short: { pl: "dopasowywaniu rekomendacji", en: "tailored recommendations" },
    image: "/cities/porto.jpg",
    credit: UNSPLASH("photo-1555881400-74d7acaacd8b"),
  },
];

export const DNA_CARD: Record<CardId, DnaCard> = Object.fromEntries(DNA_DECK.map((c) => [c.id, c])) as Record<CardId, DnaCard>;
export const STATEMENT_IDS = DNA_DECK.filter((c) => c.kind === "statement").map((c) => c.id);

/** Gesture -> stored answer. Statements: 1/3/4/5 (2 only via the dot scale). Yes/no: right = yes, left = no. */
export const STATEMENT_ANSWER: Partial<Record<Gesture, number>> = { left: 1, down: 3, right: 4, up: 5 };
export const YESNO_ANSWER: Partial<Record<Gesture, boolean>> = { left: false, right: true };

export function gesturesFor(card: DnaCard): Gesture[] {
  return card.kind === "yesno" ? ["left", "right"] : ["left", "down", "right", "up"];
}

export const ANSWER_LABEL: Record<Lang, Record<number, string>> = {
  pl: { 1: "Nie ja", 2: "Raczej nie", 3: "Zależy", 4: "To ja", 5: "Bardzo ja!" },
  en: { 1: "Not me", 2: "Not really", 3: "Depends", 4: "That's me", 5: "So me!" },
};
export const YESNO_LABEL: Record<Lang, Record<"yes" | "no", string>> = {
  pl: { yes: "Tak", no: "Nie" },
  en: { yes: "Yes", no: "No" },
};

/** One recorded swipe, for undo. */
export type DnaSwipe = { id: CardId; value: number | boolean };

export interface DnaAnswers {
  answers: Partial<Record<CardId, number>>;
  yes_no: Partial<Record<"y1" | "y2", boolean>>;
}

/** Latest answer per card wins (undo + re-swipe). */
export function collectAnswers(swipes: DnaSwipe[]): DnaAnswers {
  const out: DnaAnswers = { answers: {}, yes_no: {} };
  for (const s of swipes) {
    if (s.id === "y1" || s.id === "y2") {
      if (typeof s.value === "boolean") out.yes_no[s.id] = s.value;
    } else if (typeof s.value === "number") out.answers[s.id] = s.value;
  }
  return out;
}

export const UI: Record<Lang, Record<string, string>> = {
  pl: {
    eyebrow: "DNA Podróżnika",
    title: "Przesuń, żeby nas poznać.",
    hint: "W prawo to ja · w górę bardzo ja · w dół zależy · w lewo nie ja",
    hintYesNo: "W prawo tak · w lewo nie",
    undo: "Cofnij",
    of: "z",
    budgetTitle: "Ile chcesz wydać?",
    budgetSub: "Łącznie na osobę: lot i nocleg.",
    flexible: "Bez limitu",
    next: "Dalej",
    airportTitle: "Skąd latasz?",
    airportSub: "Możesz wybrać kilka lotnisk.",
    showDna: "Pokaż moje DNA",
    resultTitle: "Twoje DNA podróżnika.",
    resultSub: "Każda wartość pokazuje, skąd się wzięła. Zmień dowolną odpowiedź, a profil przeliczy się od razu.",
    answers: "Twoje odpowiedzi",
    weights: "Co waży w rankingu",
    interests: "Co lubisz",
    style: "Twój styl",
    because: "bo przesunąłeś",
    on: "przy",
    continue: "Wygląda dobrze, znajdź mój wolny czas",
    chat: "Dopracuj w rozmowie",
    restart: "Zacznij od nowa",
    noTailor: "Rekomendacje nie będą się dopasowywać, a ankiety po podróży nie zmienią Twojego profilu.",
    noTailorTitle: "Wybrano: bez dopasowania",
    computing: "Liczę Twój profil…",
    resultMissing: "Nie mamy jeszcze Twojego wyniku.",
    credit: "Zdjęcie",
  },
  en: {
    eyebrow: "Travel DNA",
    title: "Swipe so we can get to know you.",
    hint: "Right that's me · up so me · down depends · left not me",
    hintYesNo: "Right yes · left no",
    undo: "Undo",
    of: "of",
    budgetTitle: "How much do you want to spend?",
    budgetSub: "All-in per person: flights and stay.",
    flexible: "No limit",
    next: "Next",
    airportTitle: "Where do you fly from?",
    airportSub: "Pick as many airports as you like.",
    showDna: "Show my DNA",
    resultTitle: "Your travel DNA.",
    resultSub: "Every value shows where it came from. Change any answer and the profile recalculates straight away.",
    answers: "Your answers",
    weights: "What matters in the ranking",
    interests: "What you like",
    style: "Your style",
    because: "because you swiped",
    on: "on",
    continue: "Looks right: find my free time",
    chat: "Fine-tune by chat",
    restart: "Start over",
    noTailor: "Recommendations won't adapt, and post-trip feedback won't change your profile.",
    noTailorTitle: "You chose: no tailoring",
    computing: "Working out your profile…",
    resultMissing: "We don't have your result yet.",
    credit: "Photo",
  },
};
