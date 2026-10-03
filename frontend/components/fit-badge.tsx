"use client";

import { fitMeta } from "@/lib/fit";
import { useT } from "@/lib/i18n";
import type { FitVerdict } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FitBadge({ fit, className }: { fit: FitVerdict; className?: string }) {
  const { lang } = useT();
  const m = fitMeta(fit.label, lang);
  // Just the verdict: the check's confidence lives in the receipt's Audit row only (DECLUTTER).
  return (
    <span
      data-tour="fit"
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", m.tone, className)}
    >
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}
