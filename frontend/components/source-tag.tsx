"use client";

import { ExternalLink } from "lucide-react";
import { isSampleSource, sourceNameFor } from "@/lib/format";
import { estimatedLeg } from "@/lib/money";
import { useT } from "@/lib/i18n";
import type { Evidence } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Source of a number.
 *  - "caption" (default): "Source · 3 Oct, 10:00" under a value.
 *  - "chip": compact pill "Open-Meteo · 3 paź" (docs/DECLUTTER.md); the full timestamp and raw
 *    source id stay in the title tooltip, the link opens the original.
 */
export function SourceTag({
  e,
  variant = "caption",
  className,
}: {
  e: Pick<Evidence, "source" | "fetched_at" | "url"> & Partial<Pick<Evidence, "kind" | "label">>;
  variant?: "caption" | "chip";
  className?: string;
}) {
  const { t, fmt } = useT();
  // An estimated price leg keeps its source name and date, plus what kind of estimate it is:
  // "Google Travel Explore · cena z innych terminów", "TripAI · średnia dla miasta, nie konkretny hotel".
  const base = /^estimate:/.test(e.source) ? "TripAI" : sourceNameFor(e.source, t.receipt.source);
  const est = e.kind === "flight" || e.kind === "hotel" ? estimatedLeg(e as Pick<Evidence, "kind" | "source" | "label">) : false;
  const name = est ? `${base} · ${e.kind === "flight" ? t.money.fareOtherDates : t.money.cityAverageHotel}` : base;
  // sample data was never fetched, so no "fetched at" time
  const sample = isSampleSource(e.source);
  const chip = variant === "chip";
  const when = sample ? null : chip ? fmt.date(e.fetched_at, { day: "numeric", month: "short" }) : fmt.timestamp(e.fetched_at);
  const inner = (
    <>
      <span className="truncate">
        {name}
        {when && <> · {when}</>}
      </span>
      {e.url && <ExternalLink className="size-3 shrink-0" aria-hidden />}
    </>
  );
  // tooltip: the readable source and the exact fetch time, never the internal source id
  const title = sample ? name : `${name} · ${fmt.timestamp(e.fetched_at)}`;
  const cls = chip
    ? "inline-flex max-w-full items-center gap-1 rounded-full bg-paper-deep px-2 py-0.5 font-sans text-xs text-ink-soft"
    : "inline-flex items-center gap-1 font-sans text-xs text-muted-foreground";
  return e.url ? (
    <a href={e.url} target="_blank" rel="noreferrer" className={cn(cls, "underline-offset-2 hover:text-pine hover:underline", className)} title={title}>
      {inner}
    </a>
  ) : (
    <span className={cn(cls, className)} title={title}>
      {inner}
    </span>
  );
}
