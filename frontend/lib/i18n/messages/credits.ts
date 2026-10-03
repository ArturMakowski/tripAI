import type { Shape } from "../types";

export const en = {
  eyebrow: "Attribution",
  title: "Photo credits",
  intro:
    "Every photo in TripAI is used under a free license (CC0, public domain, CC BY or CC BY-SA). Photos are resized and compressed. Tap “source” for the original and the license name for its terms.",
  destinations: "Destinations",
  dnaCards: "Travel DNA cards",
  cropped: "Photos cropped to the card format.",
  source: "source",
  /** the one footer link to this page; photos carry no inline credit (attribution lives here) */
  link: "Photo credits",
} as const;

export const pl: Shape<typeof en> = {
  eyebrow: "Autorzy zdjęć",
  title: "Zdjęcia i licencje",
  intro:
    "Każde zdjęcie w TripAI jest użyte na wolnej licencji (CC0, domena publiczna, CC BY lub CC BY-SA). Zdjęcia są przeskalowane i skompresowane. Stuknij „źródło”, aby zobaczyć oryginał, a nazwę licencji, aby zobaczyć jej warunki.",
  destinations: "Kierunki",
  dnaCards: "Karty DNA podróżnika",
  cropped: "Zdjęcia przycięte do formatu karty.",
  source: "źródło",
  link: "Zdjęcia",
};
