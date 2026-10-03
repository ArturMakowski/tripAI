"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Collapsed secondary row ("Details ›", DECLUTTER.md): native <details>, keyboard and screen-reader friendly, no motion. */
export function Disclosure({ summary, children, className }: { summary: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <details className={cn("group", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-ink-soft select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
