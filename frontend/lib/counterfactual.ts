/**
 * The scorer's counterfactual labels arrive in the request language (backend i18n):
 * EN "same trip in Jul (peak season)", PL "ten sam wyjazd w lipcu (szczyt sezonu)".
 * We pull the month out of either so the UI can phrase it consistently; when that fails,
 * callers show the backend's own (already localised) label rather than dropping the month.
 */
const EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Polish month stems cover nominative, genitive and locative ("lipiec", "lipca", "lipcu", "lip").
const PL = ["stycz", "lut", "mar", "kwie", "maj", "czerw", "lip", "sierp", "wrze", "paźdz", "listop", "grud"];

/** 1..12, or null when the label names no month we recognise. */
export function peakMonth(label: string): number | null {
  const en = label.match(/\bin ([A-Za-z]{3})/);
  if (en) {
    const i = EN.indexOf(en[1].toLowerCase());
    if (i >= 0) return i + 1;
  }
  const pl = label.match(/\bw ([\p{L}]+)/u);
  if (pl) {
    const word = pl[1].toLowerCase();
    // "maj" must not swallow "marzec"/"marca": check the longer stems first
    const order = PL.map((s, i) => [s, i] as const).sort((a, b) => b[0].length - a[0].length);
    const hit = order.find(([s]) => word.startsWith(s));
    if (hit) return hit[1] + 1;
  }
  return null;
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
