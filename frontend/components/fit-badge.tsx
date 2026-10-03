"use client";

import { fitMeta } from "@/lib/fit";
import { useT } from "@/lib/i18n";
import type { FitVerdict } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FitBadge({ fit, className }: { fit: FitVerdict; className?: string }) {
  const { t, lang } = useT();
  const m = fitMeta(fit.label, lang);
  const confidence = t.receipt.fit.confidence(Math.round(fit.confidence * 100));
  return (
    <span
      data-tour="fit"
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", m.tone, className)}
      title={`${m.label} · ${confidence}`}
    >
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
      <span className="sr-only">, {confidence}</span>
    </span>
  );
}
