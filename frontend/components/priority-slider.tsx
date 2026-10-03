"use client";

import { Slider } from "@/components/ui/slider";
import { ContributionBar, FACTOR_COLOR } from "@/components/factor-bars";
import { useT } from "@/lib/i18n";
import { FACTORS, SLIDER_PRESETS } from "@/lib/scoring";
import type { Weights } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Single slider price <-> comfort <-> experience, plus the resulting weight mix. */
export function PrioritySlider({
  value,
  weights,
  onChange,
}: {
  value: number | null;
  weights: Weights;
  onChange: (v: number) => void;
}) {
  const { t } = useT();
  const ts = t.trips.slider;
  const pos = value ?? 50;
  const nearest = SLIDER_PRESETS.reduce((a, b) => (Math.abs(b.at - pos) < Math.abs(a.at - pos) ? b : a));
  return (
    <div data-tour="slider" className="rounded-3xl border border-line bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-semibold text-ink">{ts.question}</p>
        {value === null && <span className="text-xs font-medium text-clay">{ts.setByProfile}</span>}
      </div>
      <Slider
        value={[pos]}
        min={0}
        max={100}
        step={1}
        onValueChange={([v]) => onChange(v)}
        aria-label={ts.aria}
        className="py-2 [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:size-6 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-pine [&_[data-slot=slider-thumb]]:shadow-soft [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-[linear-gradient(90deg,var(--pine-soft),var(--sky-soft),var(--clay-soft))]"
      />
      <div className="mt-2 flex justify-between text-xs">
        {SLIDER_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.at)}
            className={cn(
              "rounded-full px-2 py-0.5 font-medium transition-colors",
              nearest.label === p.label && value !== null ? "bg-ink text-paper" : "text-muted-foreground hover:text-ink",
            )}
          >
            {ts[p.key]}
          </button>
        ))}
      </div>
      <div className="mt-4 border-t border-dashed border-line pt-3">
        <ContributionBar score={{ price: 1, weather: 1, crowds: 1, taste: 1, total: 1 }} weights={weights} className="h-1.5" />
        <div className="mt-2 grid grid-cols-4 gap-1 text-xs text-muted-foreground">
          {FACTORS.map((f) => (
            <span key={f} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: FACTOR_COLOR[f] }} />
              {t.trips.factorsShort[f]}
              <span className="tabular ml-auto font-mono text-ink">{Math.round(weights[f] * 100)}%</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
