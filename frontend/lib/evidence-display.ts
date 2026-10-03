/**
 * How an evidence row reads on screen (label …… value). One place, so every unit is shown honestly:
 *  - crowds, unit "0-1" (Eurostat nights vs the peak month): "Tłum …… 46% szczytu sezonu"
 *  - unit "0-1 rel" (no peak data, e.g. London): "76/100 (0 = najspokojniejszy miesiąc)", never a %
 *  - other "0-1" shares: "46%"; anything else: value + unit.
 */
import type { Messages } from "./i18n";
import type { Evidence } from "./types";

export function evidenceDisplay(e: Pick<Evidence, "kind" | "label" | "value" | "unit">, r: Messages["receipt"]): { label: string; value: string } {
  const n = typeof e.value === "number" ? e.value : null;
  if (n != null && e.unit === "0-1 rel")
    return { label: e.kind === "crowds" ? r.crowdsLabel : e.label, value: r.relScale(Math.round(n * 100)) };
  if (n != null && e.unit === "0-1")
    return e.kind === "crowds"
      ? { label: r.crowdsLabel, value: r.crowdsValue(Math.round(n * 100)) }
      : { label: e.label, value: `${Math.round(n * 100)}%` };
  return { label: e.label, value: `${e.value}${e.unit ? ` ${e.unit}` : ""}` };
}
