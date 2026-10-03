"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, TrendingDown, Plane, BedDouble } from "lucide-react";
import { ContributionBar } from "@/components/factor-bars";
import { ScoreRing } from "@/components/score-ring";
import { dayCount, formatPLN, formatRange } from "@/lib/format";
import type { Recommendation, Weights } from "@/lib/types";
import { cn } from "@/lib/utils";

const FALLBACK_BG = "linear-gradient(135deg, var(--pine) 0%, var(--pine-deep) 60%, var(--clay) 140%)";

export function CityPhoto({ rec, className, children }: { rec: Recommendation; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: FALLBACK_BG }}>
      {rec.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={rec.photo_url} alt={`${rec.city}, ${rec.country}`} className="absolute inset-0 size-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/0" />
      {children}
    </div>
  );
}

export function RecCard({ rec, rank, weights, featured }: { rec: Recommendation; rank: number; weights: Weights; featured?: boolean }) {
  const summer = rec.deltas?.find((d) => d.vs === "summer");
  const summerPct = summer ? Math.round((summer.cost_pln / (rec.total_cost_pln - summer.cost_pln)) * 100) : null;
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
            <span className="rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">You&rsquo;re free</span>
          )}
          {rec.window.bridge && rec.window.bridge.days_off > 0 && (
            <span className="rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
              {rec.window.bridge.days_off}d off → {rec.window.bridge.total_days}d
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
            <p className="text-xs text-muted-foreground">All-in, per person</p>
            <p className="tabular font-display text-2xl leading-tight font-semibold text-ink">{formatPLN(rec.total_cost_pln)}</p>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Plane className="size-3.5" /> {formatPLN(rec.flight_cost_pln)}
          </span>
          <span className="flex items-center gap-1">
            <BedDouble className="size-3.5" /> {formatPLN(rec.hotel_cost_pln)}
          </span>
          {summerPct !== null && summerPct < 0 && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-pine-soft px-2 py-0.5 font-medium text-pine-deep">
              <TrendingDown className="size-3.5" /> {summerPct}% vs July
            </span>
          )}
        </div>

        <ContributionBar score={rec.score} weights={weights} className="mt-3.5" />

        {featured && <p className="mt-3.5 line-clamp-3 text-sm leading-relaxed text-ink-soft">{rec.why}</p>}

        <p className="mt-3 flex items-center gap-1 text-sm font-medium text-pine">
          Why this, why now
          <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </p>
      </div>
    </Link>
  );
}
