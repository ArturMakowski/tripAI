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
  Shuffle,
  Check,
  ChevronDown,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FactorBars } from "@/components/factor-bars";
import { CityPhoto } from "@/components/rec-card";
import { CompactStars, OverallStars } from "@/components/stars";
import { OPEN_MATH_EVENT } from "@/components/fit-section";
import { LangSwitch } from "@/components/lang-switch";
import { AppShell, ModeBadge } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { dayCount } from "@/lib/format";
import { flipConditions, inputsHash } from "@/lib/scoring";
import type { RankedRecommendation, Weights } from "@/lib/types";
import { useRecommendations } from "@/lib/use-recommendations";
import { FitSection } from "@/components/fit-section";
import { SourceTag } from "@/components/source-tag";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { useT } from "@/lib/i18n";
import { useTrip } from "@/lib/store";
import { originOf } from "@/lib/handoff";
import { capitalise, peakMonth } from "@/lib/counterfactual";
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
  const { t } = useT();
  return (
    <div className="py-2">
      <p className="text-ink">{label}</p>
      <p className="mt-0.5 text-[12.5px]">
        <Delta pts={pts} pln={pln} />
      </p>
      <p className="font-sans text-xs text-muted-foreground">{t.receipt.there(there)}</p>
    </div>
  );
}

function Delta({ pts, pln }: { pts: number | null; pln: number }) {
  const { t, fmt } = useT();
  return (
    <span className="whitespace-nowrap">
      {pts != null && (
        <span className={pts >= 0 ? "text-pine" : "text-clay"}>
          {pts >= 0 ? "+" : "−"}
          {t.receipt.pts(fmt.num(Math.abs(pts), 1))}
          {" · "}
        </span>
      )}
      <span className="text-muted-foreground">
        {pln >= 0 ? t.receipt.cheaper(fmt.pln(pln)) : t.receipt.pricier(fmt.pln(-pln))}
      </span>
    </span>
  );
}

function HashLine({ rec, weights }: { rec: RankedRecommendation; weights: Weights }) {
  const [hash, setHash] = useState<string | null>(rec.inputs_hash ?? null);
  const [copied, setCopied] = useState(false);
  const { t } = useT();
  useEffect(() => {
    if (!rec.inputs_hash) inputsHash(rec, weights).then(setHash);
  }, [rec, weights]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-paper">
      <div className="min-w-0">
        <p className="text-xs text-paper/60">
          {rec.inputs_hash ? t.receipt.hashScorer(rec.scoring_version) : t.receipt.hashDevice}
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
        aria-label={t.receipt.copyHash}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // "How we scored it": collapsed by default; evidence links elsewhere on the page open it (OPEN_MATH_EVENT).
  const [showMath, setShowMath] = useState(false);
  useEffect(() => {
    const open = () => setShowMath(true);
    window.addEventListener(OPEN_MATH_EVENT, open);
    return () => window.removeEventListener(OPEN_MATH_EVENT, open);
  }, []);
  const { ranked, weights, loading, scoredAtCurrentWeights } = useRecommendations();
  const profile = useTrip((s) => s.profile);
  const { t, fmt, lang } = useT();
  const r = t.receipt;

  const rank = ranked.findIndex((r) => r.id === id);
  const rec = ranked[rank];
  const rival = rank === 0 ? ranked[1] : ranked[rank - 1];

  const flips = useMemo(() => {
    if (!rec || !rival) return [];
    // If this is #1: what would let the runner-up win. Otherwise: what would put this one on top.
    return rank === 0 ? flipConditions(rec, rival, weights) : flipConditions(rival, rec, weights);
  }, [rec, rival, rank, weights]);

  if (!rec) {
    // Keep the shared header (language switch, back) even on a stale/shared link or while loading.
    return (
      <AppShell back="/trips" title={t.common.nav.trips}>
        <div className="grid place-items-center py-24 text-sm text-muted-foreground">
          {loading ? r.loading : <Link href="/trips" className="text-pine underline-offset-2 hover:underline">{r.notFound}</Link>}
        </div>
      </AppShell>
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
  const nightsText = r.nights(nights);
  // Rebuild the known counterfactual kinds in the UI language; if the month can't be read from the
  // scorer's (already localised) label, show that label instead of dropping the month.
  const cfLabel = (c: (typeof counterfactuals)[number]) => {
    if (c.kind === "peak_season") {
      const m = peakMonth(c.label);
      return m ? r.peakSeason(fmt.monthName(m, "long")) : capitalise(c.label);
    }
    if (c.kind === "next_window" && c.window) return r.nextWindow(fmt.range(c.window));
    return c.label.charAt(0).toUpperCase() + c.label.slice(1);
  };

  return (
    <>
      <CityPhoto rec={rec} className="h-80 shrink-0" credit="link">
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button
            onClick={() => router.push("/trips")}
            className="grid size-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md hover:bg-black/45"
            aria-label={r.backToTrips}
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
              {r.rankOf(rank + 1, ranked.length)} · {rec.country}
            </p>
            <h1 className="font-display text-5xl leading-none font-medium">{rec.city}</h1>
            <p className="mt-2 text-[15px] text-white/90">
              {fmt.range(rec.window)} · {nightsText} · {fmt.pln(rec.total_cost_pln)}
            </p>
          </div>
          <OverallStars total={rec.score.total} size={18} tone="light" className="rounded-full bg-black/40 px-3 py-2 backdrop-blur-md" />
        </div>
      </CityPhoto>

      <main className="-mt-4 flex-1 rounded-t-[1.75rem] bg-paper px-5 pt-6 pb-32">
        <h2 className="font-display text-[1.9rem] leading-tight text-ink">{r.whyTitle}</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{rec.why}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bot className="size-3.5" aria-hidden /> {r.aiNote}
        </p>

        {/* ---------------- Receipt ---------------- */}
        <FitSection rec={rec} profile={profile ?? DEMO_PROFILE} lang={lang} />

        {/* One compact stars row; the exact formula, weights and points are in the collapsed Audit. */}
        <div className="mt-6 rounded-2xl border border-line bg-card px-4 py-3 shadow-soft">
          <CompactStars score={rec.score} />
          <button
            onClick={() => setShowMath((v) => !v)}
            aria-expanded={showMath}
            aria-controls="how-we-scored"
            className="mt-3 flex w-full items-center justify-between border-t border-dashed border-line pt-2.5 text-left text-sm font-medium text-pine"
          >
            {showMath ? t.stars.hideAudit : t.stars.audit}
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", showMath && "rotate-180")} aria-hidden />
          </button>
        </div>

        <div id="how-we-scored" hidden={!showMath}>
          <div className="mt-4">
          <div className="rounded-3xl border border-line bg-card p-4 shadow-soft">
            <FactorBars score={rec.score} weights={weights} />
            <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-line pt-3">
              <span className="text-sm font-semibold text-ink">{r.totalScore}</span>
              <span className="tabular font-mono text-lg font-semibold text-ink">{fmt.num(rec.score.total * 100, 1)} / 100</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.formulaBefore}
              <span className="font-mono">tripai.scoring</span>
              {r.formulaAfter}
            </p>
          </div>
            <p className="mt-2 text-xs text-muted-foreground">{t.stars.mappingNote}</p>
          </div>
        <Section title={r.flipTitle} icon={Shuffle}>
          <ul className="space-y-2">
            {priceFlip && flipHi && flipLo && (
              <li className="rounded-2xl border border-line bg-card p-3.5 text-sm text-ink shadow-soft">
                {r.priceFlipBefore(flipHi)}
                <b className="tabular">{r.priceFlipAmount(fmt.pln(priceFlip.price_increase_pln!))}</b>
                {r.priceFlipAfter(flipLo)}
                <span className="mt-1 block text-xs text-muted-foreground">{r.priceFlipSource(rec.scoring_version)}</span>
              </li>
            )}
            {flips.slice(0, 2).map((f) => (
              <li key={f.factor} className="rounded-2xl border border-line bg-card p-3.5 text-sm text-ink shadow-soft">
                {r.weightFlipBefore}
                <b>{t.trips.factors[f.factor].toLowerCase()}</b>
                {r.weightFlipMiddle}
                <b className="tabular">{r.weightFlipAmount(Math.abs(f.deltaPts), f.deltaPts > 0)}</b>
                {r.weightFlipAfter(flipLo ?? "", flipHi ?? "")}
                <span className="mt-1 block text-xs text-muted-foreground">{r.weightFlipNote}</span>
              </li>
            ))}
            {!priceFlip && !flips.length && scorerFlipValid && rec.flip && (
              <li className="rounded-2xl border border-line bg-card p-3.5 text-sm text-ink shadow-soft">{rec.flip.text}</li>
            )}
            {!rec.flip && !flips.length && (
              <li className="rounded-2xl border border-dashed border-line p-3.5 text-sm text-ink-soft">
                {r.noFlip}
              </li>
            )}
          </ul>
        </Section>
        <Section title={r.evidenceTitle} icon={ExternalLink}>
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
        <Section title={r.hashTitle} icon={Fingerprint}>
          <HashLine rec={rec} weights={weights} />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {r.hashNote}
          </p>
        </Section>
        </div>

        <Section title={r.receiptTitle} icon={Fingerprint}>
          <div className="receipt-edge bg-card px-5 pt-5 pb-8 font-mono text-[13px] shadow-soft">
            <div className="text-center">
              <p className="font-display text-lg font-semibold tracking-tight text-ink not-italic">TripAI</p>
              <p className="text-xs text-muted-foreground">
                {originOf(rec)} ⇄ {rec.iata} · {fmt.range(rec.window)} {rec.window.start.slice(0, 4)} · {r.oneAdult}
              </p>
            </div>
            <div className="my-3 border-t border-dashed border-ink/25" />
            {flight && (
              <div id={`ev-${rec.evidence.indexOf(flight)}`} className="-mx-2 rounded-lg px-2">
                <Line label={r.returnFlight} value={fmt.pln(rec.flight_cost_pln)} sub={<SourceTag e={flight} />} />
              </div>
            )}
            {hotel && (
              <div id={`ev-${rec.evidence.indexOf(hotel)}`} className="-mx-2 rounded-lg px-2">
                <Line label={r.hotelNights(nightsText)} value={fmt.pln(rec.hotel_cost_pln)} sub={<SourceTag e={hotel} />} />
              </div>
            )}
            <div className="my-2 border-t border-dashed border-ink/25" />
            <Line label={r.total} value={fmt.pln(rec.total_cost_pln)} strong />

            {baseline && (
              <div id={`ev-${rec.evidence.indexOf(baseline)}`} className="-mx-2 rounded-lg px-2">
              <Line
                label={<span className="text-muted-foreground">↳ {baseline.label.toLowerCase()}</span>}
                value={
                  <span className="text-muted-foreground">
                    {typeof baseline.value === "number" ? fmt.pln(baseline.value) : `${baseline.value} ${lang === "pl" ? "zł" : "PLN"}`}
                  </span>
                }
                sub={<SourceTag e={baseline} />}
              />
              </div>
            )}

            {(counterfactuals.length > 0 || rival) && (
              <>
                <div className="my-3 border-t border-dashed border-ink/25" />
                <p className="mb-1 text-xs tracking-[0.12em] text-muted-foreground uppercase">{r.versus}</p>
                {!scoredAtCurrentWeights && (
                  <p className="mb-1 font-sans text-xs text-muted-foreground">{r.refreshNote}</p>
                )}
                {counterfactuals.map((c) => (
                  <Compare
                    key={c.kind}
                    label={cfLabel(c)}
                    pts={scoredAtCurrentWeights ? c.score_delta * 100 : null}
                    pln={c.cost_delta_pln}
                    there={
                      `${fmt.pln(c.total_cost_pln)}` +
                      (c.temp_c != null ? ` · ${Math.round(c.temp_c)} °C` : "") +
                      (c.crowd != null ? ` · ${r.crowdsOfPeak(Math.round(c.crowd * 100))}` : "")
                    }
                  />
                ))}
                {rival && (
                  <Compare
                    label={`${rank === 0 ? r.runnerUp : `#${rival.rank}`}: ${rival.city}, ${fmt.range(rival.window)}`}
                    pts={(rec.score.total - rival.score.total) * 100}
                    pln={rival.total_cost_pln - rec.total_cost_pln}
                    there={fmt.pln(rival.total_cost_pln)}
                  />
                )}
              </>
            )}
            <div className="my-3 border-t border-dashed border-ink/25" />
            <p className="text-center text-xs text-muted-foreground">{r.cachedNote}</p>
          </div>
        </Section>



      </main>

      <div className="sticky bottom-0 z-30 border-t border-line bg-paper/90 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.9rem)] backdrop-blur-md">
        <Button asChild size="lg" className="h-12 w-full rounded-2xl text-base">
          <Link href={`/trips/${rec.id}/confirm`}>
            {r.planCta} <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </>
  );
}
