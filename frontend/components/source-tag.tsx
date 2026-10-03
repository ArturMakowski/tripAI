"use client";

import { ExternalLink } from "lucide-react";
import { formatTimestamp, isSampleSource, sourceName } from "@/lib/format";
import type { Evidence } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "Source · fetched at" caption shown under every number. */
export function SourceTag({ e }: { e: Pick<Evidence, "source" | "fetched_at" | "url"> }) {
  const inner = (
    <>
      {sourceName(e.source)}
      {/* sample data was never fetched, so no "fetched at" time */}
      {!isSampleSource(e.source) && <> · {formatTimestamp(e.fetched_at)}</>}
      {e.url && <ExternalLink className="size-3" aria-hidden />}
    </>
  );
  const cls = "inline-flex items-center gap-1 font-sans text-xs text-muted-foreground";
  return e.url ? (
    <a href={e.url} target="_blank" rel="noreferrer" className={cn(cls, "underline-offset-2 hover:text-pine hover:underline")} title={e.source}>
      {inner}
    </a>
  ) : (
    <span className={cls} title={e.source}>
      {inner}
    </span>
  );
}
