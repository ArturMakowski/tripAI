"use client";

import { LANGS } from "@/lib/i18n/types";
import { useLang, useT } from "@/lib/i18n";
import { useTrip } from "@/lib/store";
import { cn } from "@/lib/utils";

/** The one app-wide language setting (header, onboarding, profile all use this). */
export function LangSwitch({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  const lang = useLang();
  const setLang = useTrip((s) => s.setLang);
  const { t } = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t.common.language.label}
      className={cn("flex rounded-full border border-line bg-card p-0.5 font-semibold", size === "sm" ? "text-[11px]" : "text-sm", className)}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          role="radio"
          aria-checked={lang === l}
          aria-label={t.common.language[l]}
          title={t.common.language[l]}
          onClick={() => setLang(l)}
          className={cn(
            "rounded-full uppercase transition-colors",
            size === "sm" ? "px-2 py-0.5" : "px-3 py-1",
            lang === l ? "bg-ink text-paper" : "text-muted-foreground hover:text-ink",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
