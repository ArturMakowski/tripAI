/**
 * Travel DNA swipe deck (docs/TRAVEL_DNA.md): 12 statements + 2 yes/no cards,
 * PL copy primary with EN toggle. This file only describes the cards and the
 * gesture -> answer mapping; the profile itself comes from POST /profile/dna.
 */

export type { Lang } from "./i18n/types";
import * as onboarding from "./i18n/messages/onboarding";
import type { Lang } from "./i18n/types";
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

/** Deed URL of a CC licence name ("CC BY 2.0 DE" -> .../licenses/by/2.0/de/); undefined if none. */
export function licenseUrl(license: string): string | undefined {
  if (/^CC0\b/.test(license)) return "https://creativecommons.org/publicdomain/zero/1.0/";
  const m = license.match(/^CC BY (\d\.\d)(?: ([A-Z]{2}))?$/);
  return m ? `https://creativecommons.org/licenses/by/${m[1]}/${m[2] ? `${m[2].toLowerCase()}/` : ""}` : undefined;
}

const WM = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;
const FLICKR = (path: string) => `https://www.flickr.com/photos/${path}`;

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
    credit: { author: "Glenn Carstens-Peters", license: "CC0", source: WM("Paperlist.jpg") },
  },
  {
    id: "q3",
    kind: "statement",
    text: { pl: "Lubię spontanicznie zmieniać plany podczas podróży.", en: "I like changing plans spontaneously." },
    short: { pl: "spontanicznych zmianach planów", en: "changing plans spontaneously" },
    image: "/swipe/departures.jpg",
    credit: {
      author: "Marek Ślusarczyk (Tupungato)",
      license: "CC BY 3.0",
      source: WM("47_Airport_departures_board_free_photo_-_Melbourne_Airport_timetable_-_Creative_Commons_Attribution.jpg"),
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
    credit: { author: "Ian Gratton", license: "CC BY 2.0", source: WM("Food_stall,_Chatachuk_Market_(8271085684).jpg") },
  },
  {
    id: "q6",
    kind: "statement",
    text: { pl: "Szukam przede wszystkim odpoczynku i relaksu.", en: "Above all I look for rest and relaxation." },
    short: { pl: "odpoczynku i relaksie", en: "rest and relaxation" },
    image: "/swipe/rest.jpg",
    credit: { author: "Chris McClave", license: "CC BY 2.0", source: WM("Hammock_-_Polynesia.jpg") },
  },
  {
    id: "q7",
    kind: "statement",
    text: { pl: "Lubię aktywnie spędzać czas (pieszo, rower, woda).", en: "I like being active (hiking, cycling, water)." },
    short: { pl: "aktywnym wypoczynku", en: "being active" },
    image: "/swipe/active.jpg",
    credit: { author: "Kristoffer Trolle", license: "CC BY 2.0", source: FLICKR("126744325@N07/29283551075") },
  },
  {
    id: "q8",
    kind: "statement",
    text: { pl: "Często wybieram miejsca mniej turystyczne.", en: "I often pick less touristy places." },
    short: { pl: "mniej turystycznych miejscach", en: "less touristy places" },
    image: "/swipe/village.jpg",
    credit: { author: "Jorge Franganillo", license: "CC BY 4.0", source: FLICKR("46191841@N00/3728667165") },
  },
  {
    id: "q9",
    kind: "statement",
    text: { pl: "Cena ma duży wpływ na wybór kierunku i atrakcji.", en: "Price strongly drives where I go and what I do." },
    short: { pl: "cenie jako głównym kryterium", en: "price driving your choices" },
    image: "/swipe/price.jpg",
    credit: { author: "Images Money", license: "CC BY 2.0", source: FLICKR("59937401@N07/5929574223") },
  },
  {
    id: "q10",
    kind: "statement",
    text: { pl: "Jestem skłonny zapłacić więcej za wyjątkowe doświadczenie.", en: "I'll pay more for a unique experience." },
    short: { pl: "dopłacaniu za wyjątkowe przeżycia", en: "paying more for something unique" },
    image: "/swipe/balloons.jpg",
    credit: { author: "Feridun F. Alkaya", license: "CC0", source: FLICKR("11773439@N03/45010287104") },
  },
  {
    id: "q11",
    kind: "statement",
    text: { pl: "Lubię podróżować z dala od tłumów.", en: "I like travelling away from crowds." },
    short: { pl: "podróżowaniu z dala od tłumów", en: "travelling away from crowds" },
    image: "/swipe/viewpoint.jpg",
    credit: {
      author: "Mateus2019",
      license: "CC BY 2.0 DE",
      source: WM("GER_—_BY_—_Lkr._MB_—_Rottach-Egern_(Wallberg-Panoramastrasse_höchster_Aussichtspunkt).JPG"),
    },
  },
  {
    id: "q12",
    kind: "statement",
    text: { pl: "Chętnie wracam do miejsc, które już znam.", en: "I happily return to places I know." },
    short: { pl: "powrotach do znanych miejsc", en: "returning to places you know" },
    image: "/swipe/known-places.jpg",
    credit: { author: "Marc Levin (mil8)", license: "CC BY 2.0", source: FLICKR("61237118@N00/380104461") },
  },
  {
    id: "y1",
    kind: "yesno",
    text: { pl: "Czy chcesz odkrywać nowe miejsca każdego dnia?", en: "Do you want to discover new places every day?" },
    short: { pl: "codziennym odkrywaniu", en: "discovering something new daily" },
    image: "/swipe/discover.jpg",
    credit: { author: "RB Photo (rboed)", license: "CC BY 2.0", source: FLICKR("92082510@N04/15333261498") },
  },
  {
    id: "y2",
    kind: "yesno",
    text: {
      pl: "Czy aplikacja ma dopasowywać rekomendacje do Twojego stylu?",
      en: "Should the app tailor recommendations to your style?",
    },
    short: { pl: "dopasowywaniu rekomendacji", en: "tailored recommendations" },
    image: "/swipe/tailored.jpg",
    credit: { author: "Igor Ovsyannykov", license: "CC0", source: WM("Igor_Ovsyannykov_2017-05-08_(Unsplash).jpg") },
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

/** Answer labels live in the i18n dictionaries (lib/i18n/messages/onboarding.ts); re-exported for callers. */
export const ANSWER_LABEL: Record<Lang, Record<number, string>> = { pl: onboarding.pl.answers, en: onboarding.en.answers };
export const YESNO_LABEL: Record<Lang, Record<"yes" | "no", string>> = { pl: onboarding.pl.yesNo, en: onboarding.en.yesNo };

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
