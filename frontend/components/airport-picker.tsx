"use client";

import { motion } from "motion/react";
import { Plane } from "lucide-react";
import { useT } from "@/lib/i18n";
import { airportGroups, airportLabel, airportShortName } from "@/lib/airports";
import { cn } from "@/lib/utils";

/**
 * Origin airports grouped by the city they serve (Warszawa: Chopin WAW + Modlin WMI). Multi-select;
 * `required` keeps at least one airport selected.
 */
export function AirportPicker({
  value,
  onChange,
  required = false,
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
  className?: string;
}) {
  const { lang } = useT();
  return (
    <div className={cn("flex flex-wrap gap-x-3 gap-y-2", className)}>
      {airportGroups(lang).map((g) => (
        <div key={g.city} role="group" aria-label={g.city} className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">{g.city}</p>
          <div className="flex gap-1.5">
            {g.airports.map((a) => {
              const on = value.includes(a.code);
              const short = airportShortName(a, lang);
              return (
                <motion.button
                  key={a.code}
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={airportLabel(a.code, lang)}
                  title={airportLabel(a.code, lang)}
                  onClick={() => {
                    const next = on ? value.filter((c) => c !== a.code) : [...value, a.code];
                    if (!required || next.length) onChange(next);
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded-xl border px-2.5 py-2 text-sm transition-colors",
                    on ? "border-pine bg-pine text-primary-foreground shadow-soft" : "border-line bg-card text-ink",
                  )}
                >
                  <Plane className={cn("size-3.5", on ? "text-paper" : "text-pine")} aria-hidden />
                  <span className="font-mono font-semibold">{a.code}</span>
                  {short && <span className={cn("text-xs", on ? "text-paper/85" : "text-ink-soft")}>{short}</span>}
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
