/** Locale-aware formatting: "1 217 zł" / "1,217 PLN", "24–27 gru" / "24–27 Dec". */
import type { FreeWindow } from "../types";
import type { Lang } from "./types";

const LOCALE: Record<Lang, string> = { pl: "pl-PL", en: "en-GB" };
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function makeFmt(lang: Lang) {
  const locale = LOCALE[lang];
  // pl-PL skips grouping for 4-digit numbers by default ("1217"); always group for money.
  const money = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: "always" } as Intl.NumberFormatOptions);
  const plnFmt =
    lang === "pl"
      ? new Intl.NumberFormat(locale, { style: "currency", currency: "PLN", maximumFractionDigits: 0, useGrouping: "always" } as Intl.NumberFormatOptions)
      : null;
  const month = (x: Date) => x.toLocaleString(locale, { month: "short", timeZone: "UTC" }).replace(/\.$/, "");

  const pln = (n: number) => (plnFmt ? plnFmt.format(Math.round(n)) : `${money.format(Math.round(n))} PLN`);
  return {
    lang,
    locale,
    pln,
    signedPln: (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${pln(Math.abs(n))}`,
    num: (n: number, digits = 0) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n),
    pct: (x: number) => `${Math.round(x * 100)}%`,
    /** "24–27 gru" / "24–27 Dec"; across months "30 gru – 2 sty" */
    range: (w: Pick<FreeWindow, "start" | "end">) => {
      const s = day(w.start);
      const e = day(w.end);
      if (s.getUTCMonth() === e.getUTCMonth()) return `${s.getUTCDate()}–${e.getUTCDate()} ${month(e)}`;
      return `${s.getUTCDate()} ${month(s)} – ${e.getUTCDate()} ${month(e)}`;
    },
    /** "pt" / "Fri" */
    weekday: (iso: string) => day(iso).toLocaleString(locale, { weekday: "short", timeZone: "UTC" }).replace(/\.$/, ""),
    /** "3 paź, 10:00" / "3 Oct, 10:00" in Warsaw time */
    timestamp: (iso: string) =>
      new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }),
    /** "12 sie 2026" / "12 Aug 2026" */
    date: (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
      new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleString(locale, { timeZone: "Europe/Warsaw", ...opts }),
    /** "lip" / "Jul" for a month number 1..12 */
    monthName: (m: number, style: "short" | "long" = "short") =>
      new Date(Date.UTC(2026, m - 1, 15)).toLocaleString(locale, { month: style, timeZone: "UTC" }).replace(/\.$/, ""),
    /** "5 min temu" / "5 min ago" */
    relative: (iso: string, now = Date.now()) => {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
      const sec = Math.round((new Date(iso).getTime() - now) / 1000);
      const abs = Math.abs(sec);
      if (abs < 60) return rtf.format(sec, "second");
      if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
      return rtf.format(Math.round(sec / 86400), "day");
    },
  };
}

export type Fmt = ReturnType<typeof makeFmt>;
