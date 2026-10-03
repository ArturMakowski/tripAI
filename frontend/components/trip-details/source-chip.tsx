"use client";

import { Info } from "lucide-react";
import { isSampleSource, sourceNameFor } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Compact source chip (DECLUTTER.md): "ⓘ Google Flights · 3 Oct"; the full source and time are in the tooltip. */
export function SourceChip({ source, fetched_at }: { source: string; fetched_at: string }) {
  const { t, fmt } = useT();
  const sample = isSampleSource(source);
  const name = !sample && /haversine/.test(source) ? t.tripDetails.estimateSource : sourceNameFor(source, t.receipt.source);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] leading-4 text-muted-foreground"
      title={sample ? name : `${name} · ${fmt.timestamp(fetched_at)}`}
    >
      <Info className="size-3 shrink-0" aria-hidden />
      <span className="truncate">
        {name}
        {!sample && ` · ${fmt.date(fetched_at, { day: "numeric", month: "short" })}`}
      </span>
    </span>
  );
}
