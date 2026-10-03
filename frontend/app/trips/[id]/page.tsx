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
import { ModeBadge } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { dayCount, formatPLN, formatRange, formatSignedPLN, formatTimestamp, sourceName } from "@/lib/format";
import { FACTOR_LABEL, flipConditions, inputsHash } from "@/lib/scoring";
import type { Evidence, Recommendation, Weights } from "@/lib/types";
import { useRecommendations } from "@/lib/use-recommendations";
import { cn } from "@/lib/utils";

function SourceTag({ e }: { e: Pick<Evidence, "source" | "fetched_at" | "url"> }) {
  const inner = (
    <>
      {sourceName(e.source)} · {formatTimestamp(e.fetched_at)}
      {e.url && <ExternalLink className="size-2.5" aria-hidden />}
    </>
  );
  const cls = "inline-flex items-center gap-1 font-sans text-[10.5px] text-muted-foreground";
  return e.url ? (
    <a href={e.url} target="_blank" rel="noreferrer" className={cn(cls, "underline-offset-2 hover:text-pine hover:underline")} title={e.source}>
      {inner}
    </a>
  ) : (
    <span className={cls} title={e.source}>
      {inner}
    </span>
  );
}

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

function HashLine({ rec, weights }: { rec: Recommendation; weights: Weights }) {
  const [hash, setHash] = useState<string | null>(rec.inputs_hash ?? null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!rec.inputs_hash) inputsHash(rec, weights).then(setHash);
  }, [rec, weights]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-paper">
      <div className="min-w-0">
        <p className="text-[11px] text-paper/60">
          sha256(evidence + weights){rec.inputs_hash ? "" : " · computed on this device"}
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
  const { ranked, weights, loading } = useRecommendations();

  const rank = ranked.findIndex((r) => r.id === id);
  const rec = ranked[rank];
  const rival = rank === 0 ? ranked[1] : ranked[0];

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
  const flight = rec.evidence.filter((e) => e.kind === "flight");
  const hotel = rec.evidence.find((e) => e.kind === "hotel");
  const facts = rec.evidence.filter((e) => !["flight", "hotel"].includes(e.kind));
  const summer = rec.deltas?.find((d) => d.vs === "summer");
  const nextWin = rec.deltas?.find((d) => d.vs === "next_best");

  return (
    <>
      <CityPhoto rec={rec} className="h-80 shrink-0">
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button
            onClick={() => router.push("/trips")}
            className="grid size-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md hover:bg-black/45"
            aria-label="Back to trips"
          >
            <ChevronLeft className="size-5" />
          </button>
          <ModeBadge />
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
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Bot className="size-3.5" aria-hidden /> Written by AI from the evidence below. Every number in it is quoted from a source.
        </p>

        {/* ---------------- Receipt ---------------- */}
        <Section title="Score breakdown" icon={Scale}>
          <div className="rounded-3xl border border-line bg-card p-4 shadow-soft">
            <FactorBars score={rec.score} weights={weights} />
            <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-line pt-3">
              <span className="text-sm font-semibold text-ink">Total score</span>
              <span className="tabular font-mono text-lg font-semibold text-ink">{(rec.score.total * 100).toFixed(1)} / 100</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Σ factor score × your weight. Factor scores come from <span className="font-mono">tripai.scoring</span>, and the weights come
              from your slider.
            </p>
          </div>
        </Section>

        <Section title="Receipt" icon={Fingerprint}>
          <div className="receipt-edge bg-card px-5 pt-5 pb-8 font-mono text-[13px] shadow-soft">
            <div className="text-center">
              <p className="font-display text-lg font-semibold tracking-tight text-ink not-italic">TripAI</p>
              <p className="text-[11px] text-muted-foreground">
                KRK ⇄ {rec.iata} · {formatRange(rec.window)} 2027 · 1 adult
              </p>
            </div>
            <div className="my-3 border-t border-dashed border-ink/25" />
            {flight[0] && (
              <Line label="Return flight" value={formatPLN(rec.flight_cost_pln)} sub={<SourceTag e={flight[0]} />} />
            )}
            {flight[1] && (
              <Line
                label={<span className="text-muted-foreground">↳ typical</span>}
                value={<span className="text-muted-foreground">{flight[1].value} PLN</span>}
                sub={<SourceTag e={flight[1]} />}
              />
            )}
            {hotel && <Line label={`Hotel, ${nights} nights`} value={formatPLN(rec.hotel_cost_pln)} sub={<SourceTag e={hotel} />} />}
            <div className="my-2 border-t border-dashed border-ink/25" />
            <Line label="TOTAL" value={formatPLN(rec.total_cost_pln)} strong />

            {(summer || nextWin || rival) && (
              <>
                <div className="my-3 border-t border-dashed border-ink/25" />
                <p className="mb-1 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Compared with</p>
                {summer && (
                  <Line
                    label="Same trip in July"
                    value={<span className={summer.cost_pln < 0 ? "text-pine" : "text-clay"}>{formatSignedPLN(summer.cost_pln)}</span>}
                    sub={<SourceTag e={{ source: summer.source, fetched_at: summer.fetched_at, url: null }} />}
                  />
                )}
                {nextWin && (
                  <Line
                    label={`Next-best window (${nextWin.label.replace("vs. ", "")})`}
                    value={
                      <span>
                        {nextWin.score != null && <span className="text-clay">{nextWin.score} pts</span>}
                        <span className="text-muted-foreground"> · {formatSignedPLN(nextWin.cost_pln)}</span>
                      </span>
                    }
                    sub={<span className="font-sans text-[10.5px] text-muted-foreground">A lower score for that window, even where it&rsquo;s cheaper</span>}
                  />
                )}
                {rival && (
                  <Line
                    label={`${rank === 0 ? "Runner-up" : "Top pick"}: ${rival.city}`}
                    value={
                      <span>
                        <span className={rival.score.total < rec.score.total ? "text-clay" : "text-pine"}>
                          {((rival.score.total - rec.score.total) * 100).toFixed(1)} pts
                        </span>
                        <span className="text-muted-foreground"> · {formatSignedPLN(rival.total_cost_pln - rec.total_cost_pln)}</span>
                      </span>
                    }
                  />
                )}
              </>
            )}
            <div className="my-3 border-t border-dashed border-ink/25" />
            <p className="text-center text-[11px] text-muted-foreground">Prices are cached quotes, not bookable fares. They are re-checked before hand-off.</p>
          </div>
        </Section>

        <Section title="Evidence" icon={ExternalLink}>
          <ul className="divide-y divide-line rounded-3xl border border-line bg-card px-4 shadow-soft">
            {facts.map((e, i) => (
              <li key={i} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink">{e.label}</span>
                  <span className="tabular shrink-0 font-mono text-sm text-ink">
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
            {flips.slice(0, 2).map((f) => (
              <li key={f.factor} className="rounded-2xl border border-line bg-card p-3.5 text-sm text-ink shadow-soft">
                If <b>{FACTOR_LABEL[f.factor].toLowerCase()}</b> counted{" "}
                <b className="tabular">
                  {Math.abs(f.deltaPts)} pts {f.deltaPts > 0 ? "more" : "less"}
                </b>{" "}
                in your weights, {rank === 0 ? f.challenger : rec.city} would take #1.
                <span className="mt-1 block text-[11px] text-muted-foreground">Calculated exactly from the weighted sum</span>
              </li>
            ))}
            {rec.flip_conditions?.map((c) => (
              <li key={c} className="rounded-2xl border border-dashed border-line p-3.5 text-sm text-ink-soft">
                {c}
              </li>
            ))}
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
