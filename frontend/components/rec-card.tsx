"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, BedDouble, Info, Plane, TrendingDown } from "lucide-react";
import { useState } from "react";
import { ContributionBar } from "@/components/factor-bars";
import { ScoreRing } from "@/components/score-ring";
import { dayCount, formatPLN, formatRange } from "@/lib/format";
import { FitBadge } from "@/components/fit-badge";
import { disagreement } from "@/lib/fit";
import { cityPhoto } from "@/lib/photos";
import type { BridgeWindow, Recommendation, RankedRecommendation, Weights } from "@/lib/types";
import { cn } from "@/lib/utils";

const FALLBACK_BG = "linear-gradient(135deg, var(--pine) 0%, var(--pine-deep) 60%, var(--clay) 140%)";

export function CityPhoto({ rec, className, children }: { rec: Recommendation; className?: string; children?: React.ReactNode }) {
  const photo = cityPhoto(rec.iata);
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: FALLBACK_BG }}>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={`${rec.city}, ${rec.country}`} className="absolute inset-0 size-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/0" />
      {children}
    </div>
  );
}

export function RecCard({
  rec,
  weights,
  featured,
  bridge,
  refining,
  overBudgetPln,
}: {
  rec: RankedRecommendation;
  weights: Weights;
  featured?: boolean;
  bridge?: BridgeWindow;
  /** fast-phase card: price is a cached estimate, exact live price on the way */
  refining?: boolean;
  /** PLN over the user's budget (> 0 shows the badge) */
  overBudgetPln?: number | null;
}) {
  const rank = rec.rank;
  const split = disagreement(rec);
  const peak = rec.counterfactuals.find((c) => c.kind === "peak_season");
  const peakMonth = peak?.label.match(/in (\w{3})/)?.[1];
  const [showPeak, setShowPeak] = useState(false);
  const peakNote = peak
    ? `Same trip${peakMonth ? ` in ${peakMonth}` : ""} (the city's peak-crowd month): ${formatPLN(peak.total_cost_pln)} vs ${formatPLN(rec.total_cost_pln)} now · TripAI scorer ${rec.scoring_version}`
    : "";
  const nights = dayCount(rec.window) - 1;

  return (
    <Link
      href={`/trips/${rec.id}`}
      className="group block overflow-hidden rounded-[1.75rem] border border-line bg-card shadow-soft transition-shadow hover:shadow-lift"
    >
      <CityPhoto rec={rec} className={featured ? "h-60" : "h-40"}>
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <motion.span
            key={rank}
            initial={{ scale: 1.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              "grid size-8 place-items-center rounded-full font-display text-sm font-semibold backdrop-blur-md",
              rank === 1 ? "bg-paper text-ink" : "bg-black/35 text-white",
            )}
          >
            {rank}
          </motion.span>
          {rec.window.source === "gcal" && (
            <span className="rounded-full bg-black/35 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">You&rsquo;re free</span>
          )}
          {bridge && bridge.leave_days.length > 0 && (
            <span className="rounded-full bg-black/35 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">
              {bridge.leave_days.length}d off → {bridge.total_days}d
            </span>
          )}
        </div>
        <div className="absolute top-3 right-3">
          <ScoreRing value={rec.score.total} size={featured ? 58 : 48} stroke={4} tone="light" />
        </div>
        <div className="absolute right-4 bottom-3.5 left-4 text-white">
          <p className="text-xs font-medium tracking-wide text-white/80 uppercase">
            {rec.country} · {rec.iata}
          </p>
          <h3 className={cn("font-display leading-none font-medium", featured ? "text-[2.6rem]" : "text-[2rem]")}>{rec.city}</h3>
        </div>
      </CityPhoto>

      <div className="p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">When</p>
            <p className="font-display text-lg leading-tight text-ink">
              {formatRange(rec.window)} <span className="text-sm text-muted-foreground">· {nights} nights</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{refining ? "Cached estimate" : "All-in, per person"}</p>
            <motion.p
              key={rec.total_cost_pln}
              initial={{ opacity: 0.4, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "tabular rounded-md font-display text-2xl leading-tight font-semibold text-ink",
                refining && "sheen text-ink-soft",
              )}
            >
              {refining && "~"}
              {formatPLN(rec.total_cost_pln)}
            </motion.p>
            {overBudgetPln != null && overBudgetPln > 0 && (
              <span className="mt-1 inline-block rounded-full bg-clay-soft px-2 py-0.5 text-xs font-semibold text-clay">
                Over budget +{formatPLN(overBudgetPln)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Plane className="size-3.5" /> {formatPLN(rec.flight_cost_pln)}
          </span>
          <span className="flex items-center gap-1">
            <BedDouble className="size-3.5" /> {formatPLN(rec.hotel_cost_pln)}
          </span>
          {peak && peak.cost_delta_pln > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault(); // inside the card link
                setShowPeak((v) => !v);
              }}
              aria-expanded={showPeak}
              title={peakNote}
              className="ml-auto flex items-center gap-1 rounded-full bg-pine-soft px-2 py-0.5 font-medium text-pine-deep hover:bg-pine/15"
            >
              <TrendingDown className="size-3.5" aria-hidden /> −{Math.round(peak.cost_delta_pct)}% vs peak season
              <Info className="size-3 opacity-70" aria-hidden />
            </button>
          )}
        </div>
        {peak && showPeak && <p className="mt-1.5 text-right text-xs text-muted-foreground">{peakNote}</p>}

        <ContributionBar score={rec.score} weights={weights} className="mt-3.5" />

        {rec.fit && (
          <div className="mt-3.5 flex items-start gap-2.5">
            <FitBadge fit={rec.fit} className="mt-px" />
            <p className="text-[13px] leading-snug text-ink-soft">
              {split && <span className="font-semibold text-ink">Score and fit disagree. </span>}
              {rec.fit.summary}
            </p>
          </div>
        )}

        {featured && <p className="mt-3.5 line-clamp-3 text-sm leading-relaxed text-ink-soft">{rec.why}</p>}

        <p className="mt-3 flex items-center gap-1 text-sm font-medium text-pine">
          Why this, why now
          <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </p>
      </div>
    </Link>
  );
}
