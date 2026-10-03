"use client";

import Link from "next/link";
import { LayoutGroup, motion } from "motion/react";
import { ArrowDown, ArrowRight, ArrowUp, Bell, Minus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { FACTOR_COLOR, FACTOR_ICON } from "@/components/factor-bars";
import { AppShell, PageTitle } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatPLN, formatRange, pct } from "@/lib/format";
import { DEMO_PROFILE, PAST_TRIP } from "@/lib/mock/fixtures";
import { FACTORS, FACTOR_LABEL, normalise, rerank, type Factor } from "@/lib/scoring";
import { useTrip, type FeedbackDiff } from "@/lib/store";
import type { Recommendation } from "@/lib/types";
import { useRecommendations } from "@/lib/use-recommendations";
import { cn } from "@/lib/utils";

const QUESTIONS: { factor: Factor; q: string; low: string; high: string }[] = [
  { factor: "crowds", q: "How were the crowds?", low: "Unbearable", high: "Peaceful" },
  { factor: "weather", q: "And the weather?", low: "Too hot", high: "Perfect" },
  { factor: "price", q: "Value for money?", low: "Overpriced", high: "A steal" },
  { factor: "taste", q: "Did it suit what you love?", low: "Not me", high: "Exactly me" },
];

const TAGS = ["food", "history", "architecture", "beach", "nightlife", "art", "walking"];

function Rating({ value, onChange, low, high }: { value?: number; onChange: (v: number) => void; low: string; high: string }) {
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              "relative h-11 rounded-xl border text-sm font-semibold transition-colors",
              value === n ? "border-transparent text-paper" : "border-line bg-card text-ink-soft hover:border-pine/40",
            )}
            aria-pressed={value === n}
          >
            {value === n && (
              <motion.span layoutId={`r-${low}`} className="absolute inset-0 rounded-xl bg-ink" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
            )}
            <span className="relative">{n}</span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function WeightDiff({ diff }: { diff: FeedbackDiff }) {
  const b = normalise(diff.before.weights);
  const a = normalise(diff.after.weights);
  return (
    <ul className="space-y-3">
      {FACTORS.map((f, i) => {
        const Icon = FACTOR_ICON[f];
        const d = Math.round((a[f] - b[f]) * 100);
        return (
          <li key={f}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-ink">
                <Icon className="size-4" style={{ color: FACTOR_COLOR[f] }} /> {FACTOR_LABEL[f]}
              </span>
              <span className="tabular font-mono text-xs">
                <span className="text-muted-foreground">{pct(b[f])}%</span> → <span className="text-ink">{pct(a[f])}%</span>{" "}
                <span className={cn("ml-1 rounded px-1 py-0.5", d > 0 ? "bg-pine-soft text-pine-deep" : d < 0 ? "bg-clay-soft text-clay" : "text-muted-foreground")}>
                  {d > 0 ? `+${d}` : d === 0 ? "±0" : d}
                </span>
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-paper-deep">
              <div className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: `${b[f] * 100}%`, background: FACTOR_COLOR[f] }} />
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: FACTOR_COLOR[f] }}
                initial={{ width: `${b[f] * 100}%` }}
                animate={{ width: `${a[f] * 100}%` }}
                transition={{ delay: 0.4 + i * 0.12, type: "spring", stiffness: 90, damping: 18 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProfileDiff({ diff }: { diff: FeedbackDiff }) {
  const bi = diff.before.profile.interests;
  const ai = diff.after.profile.interests;
  const changed = Object.keys({ ...bi, ...ai }).filter((k) => (bi[k] ?? 0) !== (ai[k] ?? 0));
  const newDislikes = diff.after.profile.dislikes.filter((d) => !diff.before.profile.dislikes.includes(d));
  if (!changed.length && !newDislikes.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {changed.map((k) => (
        <span key={k} className="rounded-full bg-pine-soft px-3 py-1 text-sm text-pine-deep capitalize">
          {k} <span className="tabular font-mono text-xs">{(bi[k] ?? 0).toFixed(2)} → {(ai[k] ?? 0).toFixed(2)}</span>
        </span>
      ))}
      {newDislikes.map((d) => (
        <span key={d} className="rounded-full bg-clay-soft px-3 py-1 text-sm text-ink">
          <span className="text-clay">+ avoid</span> {d}
        </span>
      ))}
    </div>
  );
}

/** Shows the old order, then animates into the new one. */
function Rerank({ diff, recs }: { diff: FeedbackDiff; recs: Recommendation[] }) {
  const [order, setOrder] = useState(diff.before.ranking);
  useEffect(() => {
    const t = setTimeout(() => setOrder(diff.after.ranking), 1300);
    return () => clearTimeout(t);
  }, [diff]);
  const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
  const settled = order === diff.after.ranking;
  return (
    <LayoutGroup>
      <ol className="space-y-2">
        {order.map((id, i) => {
          const r = byId[id];
          if (!r) return null;
          const move = diff.before.ranking.indexOf(id) - diff.after.ranking.indexOf(id);
          return (
            <motion.li
              key={id}
              layout
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border bg-card p-2.5 pr-4 shadow-soft",
                settled && i === 0 ? "border-pine" : "border-line",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.photo_url ?? ""} alt="" className="size-11 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg leading-tight text-ink">{r.city}</p>
                <p className="text-xs text-muted-foreground">
                  {formatRange(r.window)} · {formatPLN(r.total_cost_pln)}
                </p>
              </div>
              {settled && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    "flex items-center gap-0.5 text-xs font-semibold",
                    move > 0 ? "text-pine" : move < 0 ? "text-clay" : "text-muted-foreground",
                  )}
                >
                  {move > 0 ? <ArrowUp className="size-3.5" /> : move < 0 ? <ArrowDown className="size-3.5" /> : <Minus className="size-3.5" />}
                  {move !== 0 && Math.abs(move)}
                </motion.span>
              )}
            </motion.li>
          );
        })}
      </ol>
    </LayoutGroup>
  );
}

export default function SurveyPage() {
  const { ranked } = useRecommendations();
  const { profile, weights, recs, setProfile, setWeights, setRecs, setMode, feedback, setFeedback } = useTrip();
  const [ratings, setRatings] = useState<Partial<Record<Factor, number>>>({});
  const [liked, setLiked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const before = { weights, profile: profile ?? DEMO_PROFILE, ranking: ranked.map((r) => r.id) };
    const fb = await api.feedback(
      { trip_id: PAST_TRIP.id, answers: { ratings: ratings as Record<string, number>, liked_tags: liked } },
      { profile: before.profile, weights },
    );
    const nextWeights = fb.data.weights ?? weights;
    const fresh = await api.recommendations({ profile: fb.data.profile, weights: nextWeights });
    setMode(fresh.mode);
    setProfile(fb.data.profile);
    setWeights(nextWeights);
    setRecs(fresh.data);
    setFeedback({
      tripId: PAST_TRIP.id,
      before,
      after: { weights: nextWeights, profile: fb.data.profile, ranking: rerank(fresh.data, nextWeights).map((r) => r.id) },
    });
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (feedback) {
    const top = recs.find((r) => r.id === feedback.after.ranking[0]);
    const changedTop = feedback.before.ranking[0] !== feedback.after.ranking[0];
    return (
      <AppShell>
        <PageTitle eyebrow="Learning from your trip" title="Your weights changed.">
          Here&rsquo;s exactly what your Barcelona feedback changed, and how your trips re-ranked.
        </PageTitle>

        {top && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.2 }}
            className="mb-6 flex items-start gap-3 rounded-2xl bg-ink p-4 text-paper shadow-lift"
          >
            <Bell className="mt-0.5 size-4 shrink-0 text-sun" />
            <p className="text-sm leading-snug">
              <span className="font-semibold">{changedTop ? "New top pick" : "Still your top pick"}:</span> free {formatRange(top.window)} →{" "}
              {top.city}, {formatPLN(top.total_cost_pln)} all-in.
            </p>
          </motion.div>
        )}

        <section className="rounded-3xl border border-line bg-card p-4 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Ranking weights</h2>
          <WeightDiff diff={feedback} />
          <div className="mt-4 border-t border-dashed border-line pt-3">
            <ProfileDiff diff={feedback} />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-ink">Re-ranked with the new weights</h2>
          <Rerank diff={feedback} recs={recs} />
        </section>

        <Button asChild size="lg" className="mt-6 h-12 w-full rounded-2xl text-base">
          <Link href="/trips">
            See updated trips <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
        <button
          onClick={() => setFeedback(null)}
          className="mx-auto mt-3 flex items-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-ink"
        >
          <RotateCcw className="size-3.5" /> Answer again
        </button>
      </AppShell>
    );
  }

  const complete = QUESTIONS.every((q) => ratings[q.factor]);

  return (
    <AppShell>
      <PageTitle eyebrow="After your trip" title="How was Barcelona?">
        Four taps. Your answers adjust the ranking weights, and we&rsquo;ll show you exactly how.
      </PageTitle>

      <div className="relative mb-6 h-36 overflow-hidden rounded-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PAST_TRIP.photo_url} alt="Barcelona" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
        <div className="absolute bottom-3 left-4 text-white">
          <p className="font-display text-2xl leading-none">{PAST_TRIP.city}</p>
          <p className="mt-1 text-sm text-white/85">{PAST_TRIP.dates}</p>
        </div>
      </div>

      <div className="space-y-6">
        {QUESTIONS.map((q) => (
          <div key={q.factor}>
            <p className="mb-2.5 text-[15px] font-medium text-ink">{q.q}</p>
            <Rating value={ratings[q.factor]} onChange={(v) => setRatings((r) => ({ ...r, [q.factor]: v }))} low={q.low} high={q.high} />
          </div>
        ))}
        <div>
          <p className="mb-2.5 text-[15px] font-medium text-ink">What did you enjoy most?</p>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((t) => {
              const on = liked.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => setLiked((l) => (on ? l.filter((x) => x !== t) : [...l, t]))}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm capitalize transition-colors",
                    on ? "border-pine bg-pine text-primary-foreground" : "border-line bg-card text-ink-soft",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Button size="lg" className="mt-8 h-12 w-full rounded-2xl text-base" disabled={!complete || busy} onClick={submit}>
        {busy ? "Updating your profile…" : "Update my profile"}
      </Button>
      <button
        onClick={() => {
          setRatings({ crowds: 1, weather: 2, price: 4, taste: 5 });
          setLiked(["food", "architecture"]);
        }}
        className="mx-auto mt-2 block py-2 text-xs text-muted-foreground hover:text-ink"
      >
        Fill demo answers
      </button>
    </AppShell>
  );
}
