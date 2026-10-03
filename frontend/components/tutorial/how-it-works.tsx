"use client";

import { ChevronRight, CircleHelp } from "lucide-react";
import { useTutorial } from "@/lib/tutorial-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

/** "Jak to działa?" row: replays the intro, and the coach marks come back on each screen. */
export function HowItWorksButton({ className }: { className?: string }) {
  const replay = useTutorial((s) => s.replay);
  const t = useT().t.tutorial;
  return (
    <button
      type="button"
      onClick={replay}
      aria-haspopup="dialog"
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-3.5 text-left shadow-soft transition-colors hover:bg-paper-deep",
        className,
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pine-soft text-pine-deep">
        <CircleHelp className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{t.howItWorks}</span>
        <span className="block text-xs text-muted-foreground">{t.howItWorksSub}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </button>
  );
}
