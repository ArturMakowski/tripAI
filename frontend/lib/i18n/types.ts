export type Lang = "pl" | "en";
export const LANGS: Lang[] = ["pl", "en"];

/**
 * The PL dictionary must have exactly the EN shape: same keys, strings for strings,
 * same parameters for functions. `as const` EN literals are widened to string here.
 */
export type Shape<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { [K in keyof T]: Shape<T[K]> };

/** Polish/English plural forms via Intl.PluralRules ("1 dzień", "2 dni", "5 dni"). */
export function plural(lang: Lang, n: number, forms: { one: string; few?: string; many?: string; other: string }): string {
  const rule = new Intl.PluralRules(lang === "pl" ? "pl-PL" : "en-GB").select(n);
  return (forms as Record<string, string | undefined>)[rule] ?? forms.other;
}
