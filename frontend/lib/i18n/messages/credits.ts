import type { Shape } from "../types";

export const en = {
  eyebrow: "Attribution",
  title: "Photo credits",
  intro:
    "Every photo in TripAI is used under a free license (CC0, public domain, CC BY or CC BY-SA). Photos are resized and compressed; nothing else is changed. Tap “source” for the original and its full license terms.",
  destinations: "Destinations",
  dnaCards: "Travel DNA cards",
  source: "source",
  /** the one footer link to this page; photos carry no inline credit (attribution lives here) */
  link: "Photo credits",
} as const;

export const pl: Shape<typeof en> = {
  eyebrow: "Autorzy zdjęć",
  title: "Zdjęcia i licencje",
  intro:
    "Każde zdjęcie w TripAI jest użyte na wolnej licencji (CC0, domena publiczna, CC BY lub CC BY-SA). Zdjęcia są tylko przeskalowane i skompresowane, nic poza tym nie zmieniamy. Stuknij „źródło”, aby zobaczyć oryginał i pełne warunki licencji.",
  destinations: "Kierunki",
  dnaCards: "Karty DNA podróżnika",
  source: "źródło",
  link: "Zdjęcia",
};
