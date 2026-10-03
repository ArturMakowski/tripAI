/**
 * "What would flip it" in plain language, mirroring the backend scorer (tripai.i18n "flip.*", PR #32)
 * so fixture mode reads exactly like live mode. The receipt only ever shows this text (never
 * frontend-computed "weight points").
 */
import type { Lang } from "./i18n/types";
import type { Factor } from "./scoring";

const FACTOR: Record<Lang, Record<Factor, (a: string, b: string) => string>> = {
  en: {
    price: (a, b) => `price matters more to you (weight from ${a} to ${b})`,
    weather: (a, b) => `weather matters more to you (weight from ${a} to ${b})`,
    crowds: (a, b) => `avoiding crowds matters more to you (weight from ${a} to ${b})`,
    taste: (a, b) => `matching your interests matters more to you (weight from ${a} to ${b})`,
  },
  pl: {
    price: (a, b) => `cena będzie dla Ciebie ważniejsza (waga z ${a} na ${b})`,
    weather: (a, b) => `pogoda będzie dla Ciebie ważniejsza (waga z ${a} na ${b})`,
    crowds: (a, b) => `unikanie tłumów będzie dla Ciebie ważniejsze (waga z ${a} na ${b})`,
    taste: (a, b) => `dopasowanie do Twoich zainteresowań będzie dla Ciebie ważniejsze (waga z ${a} na ${b})`,
  },
};

/** Polish city names that take a plural verb ("lepszą opcją będą Ateny"). */
const PL_PLURAL = new Set(["Ateny", "Helsinki", "Kanary", "Azory", "Wyspy Kanaryjskie"]);

const w = (x: number, lang: Lang) => (lang === "pl" ? x.toFixed(2).replace(".", ",") : x.toFixed(2));

export function flipText(lang: Lang, lo: string, cond: { factor: Factor; from: number; to: number } | null, hi: string): string {
  if (!cond)
    return lang === "pl"
      ? `Żadna pojedyncza zmiana ceny ani priorytetów nie sprawi, że ${lo} wyprzedzi ${hi}.`
      : `No single change in price or priorities makes ${lo} beat ${hi}.`;
  const c = FACTOR[lang][cond.factor](w(cond.from, lang), w(cond.to, lang));
  return lang === "pl" ? `Jeśli ${c}, lepszą opcją ${PL_PLURAL.has(lo) ? "będą" : "będzie"} ${lo}.` : `If ${c}, ${lo} wins.`;
}
