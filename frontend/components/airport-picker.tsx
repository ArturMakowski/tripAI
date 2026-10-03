"use client";

import { motion } from "motion/react";
import { Plane } from "lucide-react";
import { useT } from "@/lib/i18n";
import { airportGroups, airportLabel, airportShortName, toggleCity } from "@/lib/airports";
import { cn } from "@/lib/utils";

/**
 * Origin airports grouped by the city they serve. The city is the unit: its header or any of its
 * airports toggles them all (Warszawa = Chopin WAW + Modlin WMI), so the backend searches the whole
 * city in one call. `required` keeps at least one city selected.
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
      {airportGroups(lang).map((g) => {
        const on = g.airports.every((a) => value.includes(a.code));
        const toggle = () => {
          const next = toggleCity(value, g.airports);
          if (!required || next.length) onChange(next);
        };
        const names = g.airports.map((a) => airportLabel(a.code, lang)).join(", ");
        return (
          <div key={g.city} className="min-w-0">
            <button
              type="button"
              onClick={toggle}
              aria-hidden
              tabIndex={-1}
              className={cn("mb-1 text-[11px] font-medium", on ? "text-pine" : "text-muted-foreground hover:text-ink")}
            >
              {g.city}
            </button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              role="checkbox"
              aria-checked={on}
              aria-label={names}
              title={names}
              onClick={toggle}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-sm transition-colors",
                on ? "border-pine bg-pine text-primary-foreground shadow-soft" : "border-line bg-card text-ink",
              )}
            >
              <Plane className={cn("size-3.5", on ? "text-paper" : "text-pine")} aria-hidden />
              {g.airports.map((a, i) => {
                const short = airportShortName(a, lang);
                return (
                  <span key={a.code} className="flex items-center gap-1">
                    {i > 0 && <span className={on ? "text-paper/60" : "text-line"}>+</span>}
                    <span className="font-mono font-semibold">{a.code}</span>
                    {short && <span className={cn("text-xs", on ? "text-paper/85" : "text-ink-soft")}>{short}</span>}
                  </span>
                );
              })}
            </motion.button>
          </div>
        );
      })}
    </div>
  );
}
