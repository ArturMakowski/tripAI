import type { Shape } from "../types";

const decPl = (n: number) => String(n).replace(".", ",");

export const en = {
  /** "Weather: 4 out of 5 stars" */
  factorAria: (label: string, n: number) => `${label}: ${n} out of 5 stars`,
  /** "Overall: 4.5 out of 5 stars (exact 4.4)" */
  overallAria: (stars: number, exact: number) => `Overall: ${stars} out of 5 stars (exact ${exact.toFixed(1)})`,
  overall: "Overall",
  howScored: "How we scored it",
  howScoredHint: "Exact factor scores × your weights, what would flip it, every source and the inputs hash",
  hide: "Hide the math",
  mappingNote: "Stars round the scorer's 0–1 numbers: overall = round(score × 10) / 2, each factor = round(score × 5), at least 1.",
} as const;

export const pl: Shape<typeof en> = {
  factorAria: (label, n) => `${label}: ${decPl(n)} z 5 gwiazdek`,
  overallAria: (stars, exact) => `Ogółem: ${decPl(stars)} z 5 gwiazdek (dokładnie ${exact.toFixed(1).replace(".", ",")})`,
  overall: "Ogółem",
  howScored: "Jak to policzyliśmy",
  howScoredHint: "Dokładne wyniki czynników × Twoje wagi, co by to zmieniło, wszystkie źródła i skrót danych wejściowych",
  hide: "Ukryj obliczenia",
  mappingNote: "Gwiazdki zaokrąglają wyniki 0–1 z kalkulatora: ogółem = round(wynik × 10) / 2, każdy czynnik = round(wynik × 5), co najmniej 1.",
};
