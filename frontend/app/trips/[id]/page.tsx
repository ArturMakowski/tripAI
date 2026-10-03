"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowRight,
  Bot,
  ChevronLeft,
  Copy,
  ExternalLink,
  Fingerprint,
  Scale,
  Shuffle,
  Check,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FactorBars } from "@/components/factor-bars";
import { CityPhoto } from "@/components/rec-card";
import { ScoreRing } from "@/components/score-ring";
import { LangSwitch } from "@/components/lang-switch";
import { ModeBadge } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { dayCount, formatPLN, formatRange } from "@/lib/format";
import { FACTOR_LABEL, flipConditions, inputsHash } from "@/lib/scoring";
import type { RankedRecommendation, Weights } from "@/lib/types";
import { useRecommendations } from "@/lib/use-recommendations";
import { FitSection } from "@/components/fit-section";
import { SourceTag } from "@/components/source-tag";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { useLang } from "@/lib/i18n";
import { useTrip } from "@/lib/store";
import { originOf } from "@/lib/handoff";
import { cn } from "@/lib/utils";

function Section({ title, icon: Icon, children, className }: { title: string; icon: typeof Bot; children: React.ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn("mt-6", className)}
    >
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-clay uppercase">
        <Icon className="size-4" aria-hidden /> {title}
      </h2>
      {children}
    </motion.section>
  );
}

function Line({ label, value, sub, strong }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="py-2">
      <div className={cn("flex items-baseline gap-2", strong && "font-semibold")}>
        <span className="text-ink">{label}</span>
        <span className="flex-1 translate-y-[-3px] border-b border-dotted border-ink/25" />
        <span className="tabular text-ink">{value}</span>
      </div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

function Compare({ label, pts, pln, there }: { label: string; pts: number | null; pln: number; there: string }) {
  return (
    <div className="py-2">
      <p className="text-ink">{label}</p>
      <p className="mt-0.5 text-[12.5px]">
        <Delta pts={pts} pln={pln} />
      </p>
      <p className="font-sans text-xs text-muted-foreground">There: {there}</p>
    </div>
  );
}

function Delta({ pts, pln }: { pts: number | null; pln: number }) {
  return (
    <span className="whitespace-nowrap">
      {pts != null && (
        <span className={pts >= 0 ? "text-pine" : "text-clay"}>
          {pts >= 0 ? "+" : "−"}
          {Math.abs(pts).toFixed(1)} pts{" · "}
        </span>
      )}
      <span className="text-muted-foreground">
        {pln >= 0 ? `${formatPLN(pln)} cheaper` : `${formatPLN(-pln)} pricier`}
      </span>
    </span>
  );
}

function HashLine({ rec, weights }: { rec: RankedRecommendation; weights: Weights }) {
  const [hash, setHash] = useState<string | null>(rec.inputs_hash ?? null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!rec.inputs_hash) inputsHash(rec, weights).then(setHash);
  }, [rec, weights]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-paper">
      <div className="min-w-0">
        <p className="text-xs text-paper/60">
          sha256 of inputs · {rec.inputs_hash ? `scorer ${rec.scoring_version}` : "computed on this device"}
        </p>
        <p className="truncate font-mono text-sm">{hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : "…"}</p>
      </div>
      <button
        onClick={() => {
          if (!hash) return;
          navigator.clipboard?.writeText(hash);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-full bg-paper/10 p-2 hover:bg-paper/20"
        aria-label="Copy inputs hash"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ranked, weights, loading, scoredAtCurrentWeights } = useRecommendations();
  const profile = useTrip((s) => s.profile);
  const lang = useLang();

  const rank = ranked.findIndex((r) => r.id === id);
  const rec = ranked[rank];
  const rival = rank === 0 ? ranked[1] : ranked[rank - 1];

  const flips = useMemo(() => {
    if (!rec || !rival) return [];
    // If this is #1: what would let the runner-up win. Otherwise: what would put this one on top.
    return rank === 0 ? flipConditions(rec, rival, weights) : flipConditions(rival, rec, weights);
  }, [rec, rival, rank, weights]);

  if (!rec) {
    return (
      <div className="grid flex-1 place-items-center p-10 text-sm text-muted-foreground">
        {loading ? "Loading…" : <Link href="/trips">Trip not found. Back to trips.</Link>}
      </div>
    );
  }

  const nights = dayCount(rec.window) - 1;
  const flight = rec.evidence.find((e) => e.kind === "flight");
  const baseline = rec.evidence.find((e) => e.kind === "price_baseline");
  const hotel = rec.evidence.find((e) => e.kind === "hotel");
  const facts = rec.evidence.filter((e) => !["flight", "hotel", "price_baseline"].includes(e.kind));
  // Rank-independent counterfactuals come from the scorer; the runner-up follows the live ranking.
  const counterfactuals = rec.counterfactuals.filter((c) => c.kind !== "runner_up");
  // The scorer's flip is about a specific neighbour at specific weights: only show it while both still hold.
  const scorerFlipValid = !!rec.flip && scoredAtCurrentWeights && rival?.id === rec.flip.rival_id;
  const priceFlip = scorerFlipValid && rec.flip?.price_increase_pln != null ? rec.flip : null;
  const flipHi = rank === 0 ? rec.city : rival?.city;
  const flipLo = rank === 0 ? rival?.city : rec.city;

  return (
    <>
      <CityPhoto rec={rec} className="h-80 shrink-0" credit="link">
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button
            onClick={() => router.push("/trips")}
            className="grid size-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md hover:bg-black/45"
            aria-label="Back to trips"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <LangSwitch />
            <ModeBadge />
          </div>
        </div>
        <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 text-white">
          <div>
            <p className="text-xs font-medium tracking-wide text-white/80 uppercase">
              #{rank + 1} of {ranked.length} · {rec.country}
            </p>
            <h1 className="font-display text-5xl leading-none font-medium">{rec.city}</h1>
            <p className="mt-2 text-[15px] text-white/90">
              {formatRange(rec.window)} · {nights} nights · {formatPLN(rec.total_cost_pln)}
            </p>
          </div>
          <ScoreRing value={rec.score.total} size={68} stroke={5} tone="light" />
        </div>
      </CityPhoto>

      <main className="-mt-4 flex-1 rounded-t-[1.75rem] bg-paper px-5 pt-6 pb-32">
        <h2 className="font-display text-[1.9rem] leading-tight text-ink">Why this, why now</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{rec.why}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bot className="size-3.5" aria-hidden /> Written by AI from the evidence below. Every number in it is quoted from a source.
        </p>

        {/* ---------------- Receipt ---------------- */}
        <FitSection rec={rec} profile={profile ?? DEMO_PROFILE} lang={lang} />

        <Section title="Score breakdown" icon={Scale}>
          <div className="rounded-3xl border border-line bg-card p-4 shadow-soft">
            <FactorBars score={rec.score} weights={weights} />
            <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-line pt-3">
              <span className="text-sm font-semibold text-ink">Total score</span>
              <span className="tabular font-mono text-lg font-semibold text-ink">{(rec.score.total * 100).toFixed(1)} / 100</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Σ factor score × your weight. Factor scores come from <span className="font-mono">tripai.scoring</span>, and the weights come
              from your slider.
            </p>
          </div>
        </Section>

        <Section title="Receipt" icon={Fingerprint}>
          <div className="receipt-edge bg-card px-5 pt-5 pb-8 font-mono text-[13px] shadow-soft">
            <div className="text-center">
              <p className="font-display text-lg font-semibold tracking-tight text-ink not-italic">TripAI</p>
              <p className="text-xs text-muted-foreground">
                {originOf(rec)} ⇄ {rec.iata} · {formatRange(rec.window)} {rec.window.start.slice(0, 4)} · 1 adult
              </p>
            </div>
            <div className="my-3 border-t border-dashed border-ink/25" />
            {flight && (
              <div id={`ev-${rec.evidence.indexOf(flight)}`} className="-mx-2 rounded-lg px-2">
                <Line label="Return flight" value={formatPLN(rec.flight_cost_pln)} sub={<SourceTag e={flight} />} />
              </div>
            )}
            {hotel && (
              <div id={`ev-${rec.evidence.indexOf(hotel)}`} className="-mx-2 rounded-lg px-2">
                <Line label={`Hotel, ${nights} nights`} value={formatPLN(rec.hotel_cost_pln)} sub={<SourceTag e={hotel} />} />
              </div>
            )}
            <div className="my-2 border-t border-dashed border-ink/25" />
            <Line label="TOTAL" value={formatPLN(rec.total_cost_pln)} strong />

            {baseline && (
              <div id={`ev-${rec.evidence.indexOf(baseline)}`} className="-mx-2 rounded-lg px-2">
              <Line
                label={<span className="text-muted-foreground">↳ {baseline.label.toLowerCase()}</span>}
                value={<span className="text-muted-foreground">{typeof baseline.value === "number" ? formatPLN(baseline.value) : `${baseline.value} PLN`}</span>}
                sub={<SourceTag e={baseline} />}
              />
              </div>
            )}

            {(counterfactuals.length > 0 || rival) && (
              <>
                <div className="my-3 border-t border-dashed border-ink/25" />
                <p className="mb-1 text-xs tracking-[0.12em] text-muted-foreground uppercase">This trip vs.</p>
                {!scoredAtCurrentWeights && (
                  <p className="mb-1 font-sans text-xs text-muted-foreground">Score differences refresh in a moment for your new slider position.</p>
                )}
                {counterfactuals.map((c) => (
                  <Compare
                    key={c.kind}
                    label={c.label.charAt(0).toUpperCase() + c.label.slice(1)}
                    pts={scoredAtCurrentWeights ? c.score_delta * 100 : null}
                    pln={c.cost_delta_pln}
                    there={
                      `${formatPLN(c.total_cost_pln)}` +
                      (c.temp_c != null ? ` · ${Math.round(c.temp_c)} °C` : "") +
                      (c.crowd != null ? ` · crowds ${Math.round(c.crowd * 100)}% of peak` : "")
                    }
                  />
                ))}
                {rival && (
                  <Compare
                    label={`${rank === 0 ? "Runner-up" : `#${rival.rank}`}: ${rival.city}, ${formatRange(rival.window)}`}
                    pts={(rec.score.total - rival.score.total) * 100}
                    pln={rival.total_cost_pln - rec.total_cost_pln}
                    there={formatPLN(rival.total_cost_pln)}
                  />
                )}
              </>
            )}
            <div className="my-3 border-t border-dashed border-ink/25" />
            <p className="text-center text-xs text-muted-foreground">Prices are cached quotes, not bookable fares. They are re-checked before hand-off.</p>
          </div>
        </Section>

        <Section title="Evidence" icon={ExternalLink}>
          <ul className="divide-y divide-line rounded-3xl border border-line bg-card px-4 shadow-soft">
            {facts.map((e, i) => (
              <li key={i} id={`ev-${rec.evidence.indexOf(e)}`} className="-mx-2 scroll-mt-24 rounded-xl px-2 py-3">
                <div className={cn("flex justify-between gap-x-3 gap-y-1", typeof e.value === "string" ? "flex-col" : "items-baseline")}>
                  <span className="text-sm text-ink">{e.label}</span>
                  <span className={cn("tabular font-mono text-sm text-ink", typeof e.value === "string" ? "text-[13px] text-ink-soft" : "shrink-0")}>
                    {typeof e.value === "number" && e.unit === "0-1" ? `${Math.round(e.value * 100)}%` : e.value}
                    {e.unit && e.unit !== "0-1" ? ` ${e.unit}` : ""}
                  </span>
                </div>
                <SourceTag e={e} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="What would flip it" icon={Shuffle}>
          <ul className="space-y-2">
            {priceFlip && flipHi && flipLo && (
              <li className="rounded-2xl border border-line bg-card p-3.5 text-sm text-ink shadow-soft">
                If {flipHi} cost <b className="tabular">{formatPLN(priceFlip.price_increase_pln!)} more</b>, {flipLo} would rank above it.
                <span className="mt-1 block text-xs text-muted-foreground">From the TripAI scorer · {rec.scoring_version}</span>
              </li>
            )}
            {flips.slice(0, 2).map((f) => (
              <li key={f.factor} className="rounded-2xl border border-line bg-card p-3.5 text-sm text-ink shadow-soft">
                If <b>{FACTOR_LABEL[f.factor].toLowerCase()}</b> counted{" "}
                <b className="tabular">
                  {Math.abs(f.deltaPts)} pts {f.deltaPts > 0 ? "more" : "less"}
                </b>{" "}
                in your weights, {flipLo} would rank above {flipHi}.
                <span className="mt-1 block text-xs text-muted-foreground">Calculated exactly from the weighted sum at your current slider</span>
              </li>
            ))}
            {!priceFlip && !flips.length && scorerFlipValid && rec.flip && (
              <li className="rounded-2xl border border-line bg-card p-3.5 text-sm text-ink shadow-soft">{rec.flip.text}</li>
            )}
            {!rec.flip && !flips.length && (
              <li className="rounded-2xl border border-dashed border-line p-3.5 text-sm text-ink-soft">
                No single change in one weight would swap this with its neighbour.
              </li>
            )}
          </ul>
        </Section>

        <Section title="Inputs hash" icon={Fingerprint}>
          <HashLine rec={rec} weights={weights} />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            The same inputs always give the same score. The ranking is deterministic and can be audited.
          </p>
        </Section>
      </main>

      <div className="sticky bottom-0 z-30 border-t border-line bg-paper/90 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.9rem)] backdrop-blur-md">
        <Button asChild size="lg" className="h-12 w-full rounded-2xl text-base">
          <Link href={`/trips/${rec.id}/confirm`}>
            Plan this trip <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </>
  );
}
