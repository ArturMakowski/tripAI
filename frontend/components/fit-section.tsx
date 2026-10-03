"use client";

import { AlertTriangle, ArrowDownRight, Check, ChevronRight, Fingerprint, Scale } from "lucide-react";
import { useId, useState } from "react";
import { InfoTip, reveal } from "@/components/declutter";
import type { Lang } from "@/lib/dna";
import { disagreement, dnaQuotes, fitMeta } from "@/lib/fit";
import { plainLabel } from "@/lib/evidence-display";
import { useT } from "@/lib/i18n";
import type { FitPoint, RankedRecommendation, TasteProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Scroll to an evidence row (opening any collapsed section around it) and flash it. */
function jumpTo(i: number) {
  const target = document.getElementById(`ev-${i}`);
  if (!target) return;
  reveal(target, () => scrollToRow(i));
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

/** One fit claim: bold text only; the swipe quotes + evidence links sit behind a toggle. */
function Claim({ p, rec, profile, lang, tone }: { p: FitPoint; rec: RankedRecommendation; profile: TasteProfile | null; lang: Lang; tone: "match" | "concern" }) {
  const { t } = useT();
  const c = t.receipt.fit;
  const [open, setOpen] = useState(false);
  const id = useId().replace(/:/g, "");
  const quotes = dnaQuotes(p.dna, profile, lang);
  const evidence = p.evidence.filter((i) => rec.evidence[i] && !isStockPhoto(rec.evidence[i]));
  const hasDetail = quotes.length > 0 || evidence.length > 0;
  const Icon = tone === "match" ? Check : AlertTriangle;
  return (
    <li className="py-2">
      <p className="flex gap-2 text-sm leading-snug font-semibold text-ink">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "match" ? "text-pine" : "text-clay")} aria-hidden />
        <span>
          {/* the space is its own text node: "Pasuje: Jedzenie…", never "Pasuje:Jedzenie" */}
          <span className="sr-only">{tone === "match" ? c.match : c.concern}:</span> {p.text}
        </span>
      </p>
      {hasDetail && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={`claim-${id}`}
            className="mt-0.5 ml-6 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-ink"
          >
            {c.becauseSwiped}
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
          </button>
          <div id={`claim-${id}`} hidden={!open} className="mt-1 ml-6 space-y-1.5">
            {quotes.map((q) => (
              <p key={q} className="flex gap-1.5 text-xs leading-snug text-ink-soft">
                <Fingerprint className="mt-px size-3.5 shrink-0 text-clay" aria-hidden />
                {q}
              </p>
            ))}
            {evidence.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {evidence.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => jumpTo(i)}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-paper-deep px-2.5 py-1 text-xs text-ink-soft hover:bg-pine-soft hover:text-pine-deep"
                  >
                    <ArrowDownRight className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{plainLabel(rec.evidence[i].label)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/** Stock/illustration photos travel as evidence rows from the live provider; they aren't evidence. */
export function isStockPhoto(e: { kind: string; source: string; url?: string | null }) {
  return (
    e.kind === "photo" ||
    e.kind === "image" ||
    e.source.startsWith("serper:images") ||
    /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(e.url ?? "")
  );
}

/** Matches and concerns as bold one-liners (docs/DECLUTTER.md: "fit claims = bold claim only"). */
export function FitClaims({
  rec,
  profile,
  lang,
  all: showAll = false,
}: {
  rec: RankedRecommendation;
  profile: TasteProfile | null;
  lang: Lang;
  /** inside a collapsed row: every claim at once */
  all?: boolean;
}) {
  const { t } = useT();
  const [all, setAll] = useState(showAll);
  const fit = rec.fit;
  if (!fit || (!fit.matches.length && !fit.concerns.length)) return null;
  const claims = [
    ...fit.matches.map((p, i) => ({ key: `m${i}`, p, tone: "match" as const })),
    ...fit.concerns.map((p, i) => ({ key: `c${i}`, p, tone: "concern" as const })),
  ];
  // one claim on screen, the rest one tap away (review #31: keep the receipt's trust lines above the fold)
  const shown = all ? claims : claims.slice(0, 1);
  const rest = claims.length - shown.length;
  return (
    <ul className="mt-3 divide-y divide-line">
      {shown.map((c) => (
        <Claim key={c.key} p={c.p} rec={rec} profile={profile} lang={lang} tone={c.tone} />
      ))}
      {rest > 0 && (
        <li className="pt-2">
          <button type="button" onClick={() => setAll(true)} className="text-sm font-medium text-pine hover:underline">
            {t.receipt.fit.moreClaims(rest)}
          </button>
        </li>
      )}
    </ul>
  );
}

/** Score and fit pointing different ways: one line, stated openly; the why behind ⓘ. */
export function FitDisagreement({ rec, lang }: { rec: RankedRecommendation; lang: Lang }) {
  const { t } = useT();
  const c = t.receipt.fit;
  const split = disagreement(rec);
  if (!split || !rec.fit) return null;
  const score = Math.round(rec.score.total * 100);
  const label = fitMeta(rec.fit.label, lang).label.toLowerCase();
  return (
    <div role="note" className="mt-3 flex gap-2 rounded-2xl bg-sun-soft px-3 py-2 text-sm text-ink">
      <Scale className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        {split === "high_score_poor_fit" ? c.disagreeHigh(score, label) : c.disagreeLow(score, label)}{" "}
        <InfoTip>{c.disagreeTip}</InfoTip>
      </p>
    </div>
  );
}
