/**
 * Value badges (docs/BUDGET.md), deterministic from factor scores + evidence. The backend sets
 * Recommendation.value_badge / value_reason; this mirrors its rules for fixture mode.
 *  - worth_splurge: costs ≥ 15% more than the cheapest of the top-5 alternatives AND scores clearly
 *    better on the non-price factors (mean of weather, crowds, taste ≥ 0.05 higher).
 *  - great_value:  price factor ≥ 0.8 AND fit at least "good" (taste ≥ 0.7 when no verdict exists).
 * Reasons only quote numbers present in the evidence / prices.
 */
import type { Lang } from "./i18n/types";
import { moneyOf } from "./money";
import type { Recommendation } from "./types";

export const SPLURGE_MIN_PRICIER = 0.15;
export const SPLURGE_MIN_BETTER = 0.05;
export const GREAT_VALUE_PRICE = 0.8;

const nonPrice = (r: Recommendation) => (r.score.weather + r.score.crowds + r.score.taste) / 3;
const evNum = (r: Recommendation, kind: string, unit?: string) => {
  const e = r.evidence.find((x) => x.kind === kind && (!unit || x.unit === unit) && typeof x.value === "number");
  return e ? (e.value as number) : null;
};
const zl = (n: number, lang: Lang) =>
  lang === "pl"
    ? `${new Intl.NumberFormat("pl-PL", { useGrouping: "always" } as Intl.NumberFormatOptions).format(Math.round(n))} zł`
    : `${new Intl.NumberFormat("en-GB").format(Math.round(n))} PLN`;

function splurgeReason(r: Recommendation, cheap: Recommendation, lang: Lang): string {
  const extra = r.total_cost_pln - cheap.total_cost_pln;
  const parts: string[] = [];
  const t1 = evNum(r, "weather", "°C");
  const t0 = evNum(cheap, "weather", "°C");
  if (t1 != null && t0 != null && t1 - t0 >= 1) parts.push(lang === "pl" ? `${Math.round(t1 - t0)} °C cieplej` : `${Math.round(t1 - t0)} °C warmer`);
  const c1 = evNum(r, "crowds");
  const c0 = evNum(cheap, "crowds");
  if (c1 != null && c0 != null && c0 - c1 >= 0.05) {
    const pts = Math.round((c0 - c1) * 100);
    parts.push(lang === "pl" ? `tłok o ${pts} pkt mniejszy` : `crowds ${pts} pts lower`);
  }
  if (r.score.taste - cheap.score.taste >= 0.05) parts.push(lang === "pl" ? "lepiej pasuje do Twojego gustu" : "a better match for your taste");
  const vs = lang === "pl" ? `niż ${cheap.city}` : `than ${cheap.city}`;
  const head = lang === "pl" ? `+${zl(extra, lang)} ${vs}` : `+${zl(extra, lang)} ${vs}`;
  return parts.length ? `${head}: ${parts.join(", ")}` : head;
}

function valueReason(r: Recommendation, lang: Lang): string {
  const typical = r.evidence.find((e) => e.kind === "price_baseline");
  const low = typical ? Number(String(typical.value).split(/[–-]/)[0]) : NaN;
  if (Number.isFinite(low) && r.flight_cost_pln < low)
    return lang === "pl"
      ? `Lot ${zl(r.flight_cost_pln, lang)}, poniżej typowych ${typical!.value} zł`
      : `Flight ${zl(r.flight_cost_pln, lang)}, below the typical ${typical!.value} PLN`;
  const pct = Math.round(r.score.price * 100);
  return lang === "pl" ? `Cena: ${pct}/100 w rankingu, a wyjazd pasuje do Ciebie` : `Price scores ${pct}/100 and the trip fits you`;
}

/** Badges in ranking order. Only the first five are compared with each other (the "top-5 alternatives"). */
export function withValueBadges<T extends Recommendation>(ranked: T[], lang: Lang): T[] {
  const top = ranked.slice(0, 5);
  return ranked.map((r) => {
    if (r.value_badge !== undefined && r.value_badge !== null) return r; // backend verdict wins
    // never on estimates, and never against one (an other-dates price isn't a real alternative)
    if (moneyOf(r).status === "estimate") return { ...r, value_badge: null, value_reason: null };
    const others = top.filter((x) => x.id !== r.id && moneyOf(x).status !== "estimate");
    const cheapest = others.length ? others.reduce((a, b) => (b.total_cost_pln < a.total_cost_pln ? b : a)) : null;
    if (
      cheapest &&
      r.total_cost_pln >= cheapest.total_cost_pln * (1 + SPLURGE_MIN_PRICIER) &&
      nonPrice(r) - nonPrice(cheapest) >= SPLURGE_MIN_BETTER
    )
      return { ...r, value_badge: "worth_splurge", value_reason: splurgeReason(r, cheapest, lang) };
    const fitGood = r.fit ? r.fit.label === "good_fit" || r.fit.label === "great_fit" : r.score.taste >= 0.7;
    if (r.score.price >= GREAT_VALUE_PRICE && fitGood) return { ...r, value_badge: "great_value", value_reason: valueReason(r, lang) };
    return { ...r, value_badge: null, value_reason: null };
  });
}
