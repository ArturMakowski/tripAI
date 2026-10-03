"use client";

/**
 * App-wide i18n. One language setting (store `lang`, null = follow the browser: PL for
 * Polish browsers, EN otherwise), typed dictionaries (en.ts / pl.ts), Intl formatting.
 *
 *   const { t, fmt, lang } = useT();
 *   t.trips.title            // string
 *   t.windows.found(7)       // parametrised copy is a function
 *   fmt.pln(1217)            // "1 217 zł" / "1,217 PLN"
 */
import { useSyncExternalStore } from "react";
import { useTrip } from "../store";
import { en, type Messages } from "./en";
import { makeFmt, type Fmt } from "./format";
import { pl } from "./pl";
import type { Lang } from "./types";

export type { Lang, Messages, Fmt };
export { plural } from "./types";

export const MESSAGES: Record<Lang, Messages> = { en, pl };
const FMT: Record<Lang, Fmt> = { en: makeFmt("en"), pl: makeFmt("pl") };

export function browserLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith("pl")) ? "pl" : "en";
}

const noop = () => () => {};

/** The effective language: the user's choice, else the browser's (EN on the server). */
export function useLang(): Lang {
  const chosen = useTrip((s) => s.lang);
  const auto = useSyncExternalStore(noop, browserLang, () => "en" as Lang);
  return chosen ?? auto;
}

export function useT(): { t: Messages; fmt: Fmt; lang: Lang } {
  const lang = useLang();
  return { t: MESSAGES[lang], fmt: FMT[lang], lang };
}

/** For non-React code (API client, mocks). */
export const messagesFor = (lang: Lang) => MESSAGES[lang];
export const fmtFor = (lang: Lang) => FMT[lang];
