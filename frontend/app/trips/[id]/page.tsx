"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, BedDouble, Bot, Check, ChevronLeft, Copy, MapPinned, Plane } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip, Disclosure, InfoTip } from "@/components/declutter";
import { FactorBars } from "@/components/factor-bars";
import { FitBadge } from "@/components/fit-badge";
import { FitAudit, FitClaims, FitDisagreement, isStockPhoto } from "@/components/fit-section";
import { CompactStars, OverallStars } from "@/components/stars";
import { LangSwitch } from "@/components/lang-switch";
import { MoneyLines, PriceInline } from "@/components/money";
import { PlacesSection } from "@/components/places-section";
import { CityPhoto } from "@/components/rec-card";
import { AppShell, PhotoCreditsLink } from "@/components/shell";
import { SourceTag } from "@/components/source-tag";
import { Button } from "@/components/ui/button";
import { FlightBlock } from "@/components/trip-details/flight-block";
import { StayBlock, TransferList } from "@/components/trip-details/stay-block";
import { TripMap } from "@/components/trip-details/trip-map";
import { trustedDetails } from "@/lib/trip-details";
import { capitalise, peakMonth } from "@/lib/counterfactual";
import { dayCount } from "@/lib/format";
import { useT, type Fmt, type Messages } from "@/lib/i18n";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { inputsHash } from "@/lib/scoring";
import { useTrip } from "@/lib/store";
import type { Evidence, RankedRecommendation, Weights } from "@/lib/types";
import { evidenceDisplay } from "@/lib/evidence-display";
import { moneyOf } from "@/lib/money";
import { overallOutOfFive } from "@/lib/stars";
import { scoreGap } from "@/lib/compare";
import { localCountry } from "@/lib/country";
import { useRecommendations } from "@/lib/use-recommendations";
import { cn } from "@/lib/utils";

/** "Rome: 3.2 pts higher · 120 PLN cheaper": always says which trip the numbers describe. */
/** `pln` is null when either side is an estimate: never compare against a price from other dates. */
function Delta({ subject, pts, pln }: { subject: string; pts: number | null; pln: number | null }) {
  const { t, fmt } = useT();
  const r = t.receipt;
  return (
    <span>
      <b className="font-semibold text-ink">{subject}:</b>{" "}
      {pts != null && (
        // under half a point the one-decimal number would read "0,0 pkt": call it what it is
        <span className={{ tie: "text-ink-soft", higher: "text-pine", lower: "text-clay" }[scoreGap(pts)]}>
          {{ tie: r.practicallyTie, higher: r.ptsHigher(fmt.num(Math.abs(pts), 1)), lower: r.ptsLower(fmt.num(Math.abs(pts), 1)) }[scoreGap(pts)]}
        </span>
      )}
      {pts != null && pln != null && " · "}
      {pln != null && <span className="text-muted-foreground">{pln >= 0 ? r.cheaper(fmt.pln(pln)) : r.pricier(fmt.pln(-pln))}</span>}
    </span>
  );
}

function Compare({ label, subject, pts, pln, there }: { label: string; subject: string; pts: number | null; pln: number | null; there?: string }) {
  const { t } = useT();
  return (
    <div className="py-1.5 text-sm">
      <p className="text-ink">{label}</p>
      <p className="text-[12.5px]">
        <Delta subject={subject} pts={pts} pln={pln} />
      </p>
      {there && <p className="text-xs text-muted-foreground">{t.receipt.there(there)}</p>}
    </div>
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
        <p className="text-xs text-paper/60">{rec.inputs_hash ? t.receipt.hashScorer(rec.scoring_version) : t.receipt.hashDevice}</p>
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

/** The AI "why", clamped to two lines with a More/Less toggle. */
function WhyText({ text }: { text: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const long = text.length > 110;
  return (
    <div className="mt-3">
      <p className={cn("text-[15px] leading-relaxed text-ink-soft", !open && "line-clamp-2")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-0.5 text-sm font-medium text-pine hover:underline">
          {open ? t.common.less : t.common.more}
        </button>
      )}
    </div>
  );
}

/**
 * The typical/median comparison as one chip, using only numbers present in the evidence:
 * a numeric baseline ("Seasonal median total") becomes "31% below typical (1,449 PLN)",
 * a fare range ("310–480") becomes "Typical 310–480 PLN".
 */
function typicalChip(rec: RankedRecommendation, base: Evidence, r: Messages["receipt"], fmt: Fmt): string | null {
  if (typeof base.value === "number") {
    const mine = /total|median|łącz/i.test(base.label) ? rec.total_cost_pln : rec.flight_cost_pln;
    const pct = Math.round(((base.value - mine) / base.value) * 100);
    if (pct >= 1) return r.belowTypical(pct, fmt.pln(base.value));
    if (pct <= -1) return r.aboveTypical(-pct, fmt.pln(base.value));
    return r.typicalRange(fmt.pln(base.value));
  }
  const [a, b] = String(base.value).split(/[–-]/).map((x) => Number(x.trim()));
  if (Number.isFinite(a) && Number.isFinite(b)) return r.typicalRange(`${fmt.num(a)}–${fmt.pln(b)}`);
  return null;
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ranked, weights, loading, scoredAtCurrentWeights } = useRecommendations();
  const profile = useTrip((s) => s.profile);
  const { t, fmt, lang } = useT();
  const r = t.receipt;
  const td = t.tripDetails;

  const rank = ranked.findIndex((x) => x.id === id);
  const rec = ranked[rank];
  const rival = rank === 0 ? ranked[1] : ranked[rank - 1];


  if (!rec) {
    // Keep the shared header (language switch, back) even on a stale/shared link or while loading.
    return (
      <AppShell back="/trips" title={t.common.nav.trips}>
        <div className="grid place-items-center py-24 text-sm text-muted-foreground">
          {loading ? (
            r.loading
          ) : (
            <Link href="/trips" className="text-pine underline-offset-2 hover:underline">
              {r.notFound}
            </Link>
          )}
        </div>
      </AppShell>
    );
  }

  const nights = dayCount(rec.window) - 1;
  const nightsText = r.nights(nights);
  const ev = (e: Evidence) => `ev-${rec.evidence.indexOf(e)}`;
  const details = trustedDetails(rec);
  const baseline = rec.evidence.find((e) => e.kind === "price_baseline");
  const confidence = rec.evidence.find((e) => e.kind === "confidence" && typeof e.value === "number");
  // Everything else is listed under "Evidence"; stock photos aren't evidence.
  const facts = rec.evidence.filter(
    (e) => !["flight", "hotel", "price_baseline", "confidence"].includes(e.kind) && !isStockPhoto(e),
  );
  // an estimate is never compared with typical prices (docs/BUDGET.md "Price honesty")
  const recEstimate = moneyOf(rec).status === "estimate";
  const typical = baseline && !recEstimate ? typicalChip(rec, baseline, r, fmt) : null;

  // Rank-independent counterfactuals come from the scorer; the runner-up follows the live ranking.
  const counterfactuals = rec.counterfactuals.filter((c) => c.kind !== "runner_up");
  // The scorer's flip is about a specific neighbour at specific weights: only show it while both still hold.
  const scorerFlipValid = !!rec.flip && scoredAtCurrentWeights && rival?.id === rec.flip.rival_id;
  const flipHi = rank === 0 ? rec.city : rival?.city;
  const flipLo = rank === 0 ? rival?.city : rec.city;
  // Rebuild the known counterfactual kinds in the UI language; if the month can't be read from the
  // scorer's (already localised) label, show that label instead of dropping the month.
  const cfLabel = (c: (typeof counterfactuals)[number]) => {
    if (c.kind === "peak_season") {
      const m = peakMonth(c.label);
      return m ? r.peakSeason(fmt.monthName(m, "long")) : capitalise(c.label);
    }
    if (c.kind === "next_window" && c.window) return r.nextWindow(fmt.range(c.window));
    return capitalise(c.label);
  };
  // "What would flip it": only the scorer's plain-language text (tripai.i18n "flip.*", PR #32), never
  // frontend-computed weight points. It holds for a specific neighbour at specific weights.
  const flipText = scorerFlipValid && rec.flip ? rec.flip.text : flipLo && flipHi ? r.noFlip(flipLo, flipHi) : null;

  return (
    <>
      <CityPhoto rec={rec} className="h-60 shrink-0">
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button
            onClick={() => router.push("/trips")}
            className="grid size-10 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md hover:bg-black/45"
            aria-label={r.backToTrips}
          >
            <ChevronLeft className="size-5" />
          </button>
          <LangSwitch />
        </div>
        <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-3 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tracking-wide text-white/80 uppercase">
              {r.rankOf(rank + 1, ranked.length)} · {localCountry(rec.country, fmt.locale)}
            </p>
            <h1 className="font-display text-[clamp(2rem,11cqw,3rem)] leading-none font-medium [overflow-wrap:anywhere]">{rec.city}</h1>
            <p className="mt-2 text-[15px] text-white/90">
              {fmt.range(rec.window)} · {nightsText} · <PriceInline rec={rec} tone="light" />
            </p>
          </div>
          <OverallStars total={rec.score.total} size={14} tone="light" className="shrink-0 rounded-full bg-black/40 px-2.5 py-1.5 backdrop-blur-md" />
        </div>
      </CityPhoto>

      <main className="-mt-4 flex-1 rounded-t-[1.75rem] bg-paper px-5 pt-5 pb-32">
        {/* Above the fold (DECLUTTER "always visible"): fit badge + AI chip, then the money with one
            source chip per line; then stars + one fit claim, and the why in two lines. */}
        <div className="flex flex-wrap items-center gap-2">
          {rec.fit && <FitBadge fit={rec.fit} />}
          <Chip icon={<Bot className="size-3.5 shrink-0" aria-hidden />}>{r.aiChip}</Chip>
          <InfoTip>{r.aiTip}</InfoTip>
        </div>

        {/* Receipt: the money, one source chip per line */}
        <section className="receipt-edge mt-3 bg-card px-4 pt-3 pb-7 font-mono shadow-soft">
          <MoneyLines rec={rec} nights={nightsText} idFor={ev} />
          {/* data confidence lives in Audit only (docs/USER_TESTING.md) */}
          {typical && baseline && (
            <div className="mt-1 flex flex-wrap gap-1.5 font-sans">
              <span id={ev(baseline)} className="rounded-full">
                <Chip title={`${baseline.label} · ${baseline.source}`}>{typical}</Chip>
              </span>
            </div>
          )}
          {rival && (
            <div className="mt-2 border-t border-dashed border-ink/25 pt-1.5 font-sans">
              <Compare
                subject={rec.city}
                label={`${rank === 0 ? r.runnerUp : `#${rival.rank}`}: ${rival.city}, ${fmt.range(rival.window)}`}
                pts={(rec.score.total - rival.score.total) * 100}
                pln={recEstimate || moneyOf(rival).status === "estimate" ? null : rival.total_cost_pln - rec.total_cost_pln}
              />
            </div>
          )}
        </section>

        <section className="mt-5 rounded-3xl border border-line bg-card p-4 shadow-soft" aria-label={t.stars.overall}>
          <CompactStars score={rec.score} />
          <FitClaims rec={rec} profile={profile ?? DEMO_PROFILE} lang={lang} />
        </section>
        <WhyText text={rec.why} />
        <FitDisagreement rec={rec} lang={lang} />

        {/* where to eat / what to do (T14, #33): compact rows, more behind "+N" */}
        <PlacesSection iata={rec.iata} profile={profile ?? DEMO_PROFILE} />

        {/* One tap away: everything precise and auditable */}
        <div className="mt-4 space-y-2.5">
          {/* which flight, which hotel, where and how to get there (docs/TRIP_DETAILS.md, #28) */}
          {details.flight && (
            <Disclosure title={td.flightTitle} icon={<Plane className="size-4" aria-hidden />}>
              <FlightBlock flight={details.flight} />
            </Disclosure>
          )}
          {details.hotel && (
            <Disclosure title={td.stayTitle} hint={details.hotel.name} icon={<BedDouble className="size-4" aria-hidden />}>
              <StayBlock hotel={details.hotel} />
              <h3 className="mt-4 mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <MapPinned className="size-4 text-pine" aria-hidden /> {td.mapTitle}
              </h3>
              <TripMap hotel={details.hotel} city={rec.city} />
              <h3 className="mt-4 mb-2 text-sm font-semibold text-ink">{td.transfersTitle}</h3>
              <TransferList transfers={details.hotel.transfers} />
            </Disclosure>
          )}
          {counterfactuals.length > 0 && (
            <Disclosure title={r.compareTitle} count={counterfactuals.length}>
              {!scoredAtCurrentWeights && <p className="mb-1 text-xs text-muted-foreground">{r.refreshNote}</p>}
              {counterfactuals.map((c) => (
                <Compare
                  key={c.kind}
                  subject={rec.city}
                  label={cfLabel(c)}
                  pts={scoredAtCurrentWeights ? c.score_delta * 100 : null}
                  pln={recEstimate ? null : c.cost_delta_pln}
                  there={
                    (recEstimate ? "" : `${fmt.pln(c.total_cost_pln)}`) +
                    (c.temp_c != null ? ` · ${Math.round(c.temp_c)} °C` : "") +
                    (c.crowd != null ? ` · ${r.crowdsOfPeak(Math.round(c.crowd * 100))}` : "")
                  }
                />
              ))}
            </Disclosure>
          )}

          {flipText && (
            <Disclosure title={r.flipTitle} hint={flipText} tour="flip">
              <p className="text-sm text-ink">{flipText}</p>
              {scorerFlipValid && <p className="mt-1 text-xs text-muted-foreground">{r.flipSource(rec.scoring_version)}</p>}
            </Disclosure>
          )}

          <Disclosure title={r.evidenceTitle} count={r.sources(facts.length)}>
            <ul className="divide-y divide-line">
              {facts.map((e) => (
                <li key={ev(e)} id={ev(e)} className="-mx-2 scroll-mt-24 rounded-xl px-2 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink" title={e.label}>
                      {evidenceDisplay(e, r).label}
                    </span>
                    <span className="tabular max-w-[55%] shrink-0 text-right font-mono text-sm break-words text-ink-soft" title={String(e.value)}>
                      {evidenceDisplay(e, r).value}
                    </span>
                  </div>
                  <SourceTag e={e} variant="chip" className="mt-1" />
                </li>
              ))}
            </ul>
          </Disclosure>

          <Disclosure title={r.auditTitle} hint={r.auditHint}>
            <FactorBars score={rec.score} weights={weights} />
            <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-line pt-3">
              <span className="text-sm font-semibold text-ink">{r.totalScore}</span>
              <span className="tabular font-mono text-lg font-semibold text-ink">
                {fmt.num(rec.score.total * 100, 1)} / 100
                <span className="ml-2 text-sm font-normal text-muted-foreground">= {fmt.num(overallOutOfFive(rec.score.total), 1)}/5</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{r.formulaTip}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.stars.mappingNote}</p>
            <div className="mt-4 border-t border-dashed border-line pt-3">
              <HashLine rec={rec} weights={weights} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.hashNote}</p>
            {rec.fit && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-ink">{r.fitCheck}</p>
                <FitAudit rec={rec} profile={profile ?? DEMO_PROFILE} lang={lang} />
              </div>
            )}
            {confidence && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-ink">{r.dataConfidence}</p>
                <p className="text-xs text-ink-soft">{confidence.label}</p>
              </div>
            )}
          </Disclosure>
        </div>
        <PhotoCreditsLink className="mt-10" />
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
