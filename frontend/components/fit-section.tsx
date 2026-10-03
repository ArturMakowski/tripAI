"use client";

import { motion } from "motion/react";
import { AlertTriangle, ArrowDownRight, Fingerprint, HeartHandshake, Scale } from "lucide-react";
import { FitBadge } from "@/components/fit-badge";
import type { Lang } from "@/lib/dna";
import { disagreement, dnaQuotes, fitMeta, modelLabel } from "@/lib/fit";
import { useT } from "@/lib/i18n";
import type { FitPoint, RankedRecommendation, TasteProfile } from "@/lib/types";
import { overallOutOfFive } from "@/lib/stars";
import { cn } from "@/lib/utils";

/** Fired to expand the receipt's collapsed Audit section (where most evidence rows live). */
export const OPEN_MATH_EVENT = "tripai:open-math";

/** Scroll to an evidence row and flash it, so every claim is one tap from its source. */

function jumpTo(i: number) {
  const target = document.getElementById(`ev-${i}`);
  if (target && target.closest("[hidden]")) {
    window.dispatchEvent(new Event(OPEN_MATH_EVENT));
    // wait for React to un-hide the section, then scroll
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToRow(i)));
    return;
  }
  scrollToRow(i);
}

function scrollToRow(i: number) {
  const el = document.getElementById(`ev-${i}`);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  // Move focus too, so keyboard and screen-reader users land on the cited row.
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
  if (!reduce)
    el.animate(
      [{ backgroundColor: "color-mix(in oklch, var(--sun) 35%, transparent)" }, { backgroundColor: "transparent" }],
      { duration: 1600, easing: "ease-out" },
    );
}

function Point({ p, rec, profile, lang, tone }: { p: FitPoint; rec: RankedRecommendation; profile: TasteProfile | null; lang: Lang; tone: "match" | "concern" }) {
  const quotes = dnaQuotes(p.dna, profile, lang);
  return (
    <li className={cn("rounded-2xl border bg-card p-3.5 shadow-soft", tone === "concern" ? "border-clay/30" : "border-line")}>
      <p className="text-sm leading-snug font-medium text-ink">{p.text}</p>
      {quotes.map((q) => (
        <p key={q} className="mt-1.5 flex gap-1.5 text-xs leading-snug text-ink-soft">
          <Fingerprint className="mt-px size-3.5 shrink-0 text-clay" aria-hidden />
          {q}
        </p>
      ))}
      {p.evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.evidence
            .filter((i) => rec.evidence[i])
            .map((i) => (
              <button
                key={i}
                onClick={() => jumpTo(i)}
                className="inline-flex items-center gap-1 rounded-full bg-paper-deep px-2.5 py-1 text-xs text-ink-soft hover:bg-pine-soft hover:text-pine-deep"
              >
                <ArrowDownRight className="size-3" aria-hidden />
                {rec.evidence[i].label}
              </button>
            ))}
        </div>
      )}
    </li>
  );
}

export function FitSection({ rec, profile, lang }: { rec: RankedRecommendation; profile: TasteProfile | null; lang: Lang }) {
  const { t, fmt } = useT();
  const c = t.receipt.fit;
  const fit = rec.fit;
  if (!fit) return null;
  const split = disagreement(rec);
  const neutral = profile?.personalize === false;
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
      <div className="rounded-3xl border border-line bg-card p-4 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl text-ink">{c.title}</h2>
          <FitBadge fit={fit} />
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{fit.summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {modelLabel(fit, lang)} · {c.confidence(Math.round(fit.confidence * 100))}
          {fit.created_at && ` · ${fmt.timestamp(fit.created_at)}`}
          {neutral && ` · ${c.neutral}`}
        </p>

        {split && (
          <div role="note" className="mt-3 flex gap-2.5 rounded-2xl bg-sun-soft p-3 text-sm text-ink">
            <Scale className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {split === "high_score_poor_fit" ? (
                <>
                  <b>{c.highScoreB(fmt.num(overallOutOfFive(rec.score.total), 1))}</b>
                  {c.highScoreC}
                  <b>{fitMeta(fit.label, lang).label.toLowerCase()}</b>
                  {c.highScoreD}
                </>
              ) : (
                <>
                  <b>{c.lowScoreB(fmt.num(overallOutOfFive(rec.score.total), 1))}</b>
                  {c.lowScoreC}
                  <b>{fitMeta(fit.label, lang).label.toLowerCase()}</b>
                  {c.lowScoreD}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {fit.matches.length > 0 && (
        <>
          <h3 className="mt-5 mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-pine uppercase">
            <HeartHandshake className="size-4" aria-hidden /> {c.whyFits}
          </h3>
          <ul className="space-y-2">
            {fit.matches.map((p, i) => (
              <Point key={i} p={p} rec={rec} profile={profile} lang={lang} tone="match" />
            ))}
          </ul>
        </>
      )}

      {fit.concerns.length > 0 && (
        <>
          <h3 className="mt-5 mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-clay uppercase">
            <AlertTriangle className="size-4" aria-hidden /> {c.watchOut}
          </h3>
          <ul className="space-y-2">
            {fit.concerns.map((p, i) => (
              <Point key={i} p={p} rec={rec} profile={profile} lang={lang} tone="concern" />
            ))}
          </ul>
        </>
      )}
    </motion.section>
  );
}
