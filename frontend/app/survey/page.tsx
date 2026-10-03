"use client";

import Link from "next/link";
import { LayoutGroup, motion } from "motion/react";
import { ArrowDown, ArrowRight, ArrowUp, Bell, Minus, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FACTOR_COLOR, FACTOR_ICON } from "@/components/factor-bars";
import { CityPhoto } from "@/components/rec-card";
import { AppShell, PageTitle } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { FACTORS, normalise, rerank, type Factor } from "@/lib/scoring";
import { useTrip, type FeedbackDiff } from "@/lib/store";
import { surveyTrip } from "@/lib/trips";
import type { Change } from "@/lib/types";
import { useRecommendations } from "@/lib/use-recommendations";
import { cn } from "@/lib/utils";

const QUESTION_ORDER: Factor[] = ["crowds", "weather", "price", "taste"];
const TAGS = ["food", "history", "architecture", "beach", "nightlife", "art", "walking"] as const;

/** The past trip's dates come from its id (IATA-YYYYMMDD-YYYYMMDD). */
function pastTripWindow(id: string) {
  const [, a, b] = id.split("-");
  const iso = (x: string) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
  return a && b ? { start: iso(a), end: iso(b) } : null;
}

function Rating({
  value,
  onChange,
  low,
  high,
  labelledBy,
}: {
  value?: number;
  onChange: (v: number) => void;
  low: string;
  high: string;
  labelledBy: string;
}) {
  const { t } = useT();
  return (
    <div>
      <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              "relative h-11 rounded-xl border text-sm font-semibold transition-colors",
              value === n ? "border-transparent text-paper" : "border-line bg-card text-ink-soft hover:border-pine/40",
            )}
            role="radio"
            aria-checked={value === n}
            aria-label={t.survey.ratingAria(n, n === 1 ? low : n === 5 ? high : null)}
          >
            {value === n && (
              <motion.span layoutId={`r-${low}`} className="absolute inset-0 rounded-xl bg-ink" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
            )}
            <span className="relative">{n}</span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function WeightDiff({ diff }: { diff: FeedbackDiff }) {
  const { t } = useT();
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
                <Icon className="size-4" style={{ color: FACTOR_COLOR[f] }} /> {t.trips.factors[f]}
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

function fmtVal(v: Change["before"], none: string, num: (n: number) => string) {
  if (v == null) return "–";
  if (Array.isArray(v)) return v.join(", ") || none;
  return typeof v === "number" ? num(v) : v;
}

/** Non-weight changes from the backend diff, each with its reason. */
function ProfileDiff({ diff }: { diff: FeedbackDiff }) {
  const { t, fmt } = useT();
  const tagName = (k: string) => (t.survey.tags as Record<string, string>)[k] ?? k;
  const v = (x: Change["before"]) => fmtVal(x, t.survey.none, (n) => fmt.num(n, 2));
  const changes = diff.diff.filter((c) => !c.field.startsWith("weights."));
  if (!changes.length) return null;
  return (
    <ul className="space-y-2">
      {changes.map((c, i) => {
        const [group, key] = c.field.split(".");
        const isDislike = group === "dislikes";
        const added = isDislike && Array.isArray(c.after) && Array.isArray(c.before) ? c.after.filter((x) => !(c.before as string[]).includes(x)) : [];
        return (
          <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
            <span className={cn("rounded-full px-2.5 py-0.5 capitalize", isDislike ? "bg-clay-soft text-ink" : "bg-pine-soft text-pine-deep")}>
              {isDislike ? (
                <>
                  <span className="text-clay">{t.survey.avoid}</span> {added.join(", ")}
                </>
              ) : (
                <>
                  {key ? tagName(key) : group.replaceAll("_", " ")}{" "}
                  <span className="tabular font-mono text-xs">
                    {v(c.before)} → {v(c.after)}
                  </span>
                </>
              )}
            </span>
            <span className="text-right text-xs text-muted-foreground">{c.reason}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Shows the top trips in their old order, then animates into the new one. */
function Rerank({ diff }: { diff: FeedbackDiff }) {
  const { t, fmt } = useT();
  const top = diff.after.ranking.slice(0, 5);
  const beforeIdx = (id: string) => {
    const i = diff.before.ranking.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const initial = [...top].sort((x, y) => beforeIdx(x) - beforeIdx(y));
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1300);
    return () => clearTimeout(t);
  }, [diff]);
  const order = settled ? top : initial;
  return (
    <LayoutGroup>
      <ol className="space-y-2">
        {order.map((id, i) => {
          const r = diff.items[id];
          if (!r) return null;
          const was = beforeIdx(id);
          const move = Number.isFinite(was) ? was - diff.after.ranking.indexOf(id) : null;
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
              <CityPhoto rec={r} thumb className="size-11 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg leading-tight text-ink">{r.city}</p>
                <p className="text-xs text-muted-foreground">
                  {fmt.range(r.window)} · {fmt.pln(r.total_cost_pln)}
                </p>
              </div>
              {settled && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    "flex items-center gap-0.5 text-xs font-semibold",
                    move == null || move > 0 ? "text-pine" : move < 0 ? "text-clay" : "text-muted-foreground",
                  )}
                >
                  {move == null ? (
                    t.survey.isNew
                  ) : move > 0 ? (
                    <ArrowUp className="size-3.5" />
                  ) : move < 0 ? (
                    <ArrowDown className="size-3.5" />
                  ) : (
                    <Minus className="size-3.5" />
                  )}
                  {move != null && move !== 0 && Math.abs(move)}
                </motion.span>
              )}
            </motion.li>
          );
        })}
      </ol>
    </LayoutGroup>
  );
}

export default function SurveyRoute() {
  // useSearchParams (My trips → Past → "Rate trip" passes ?trip=&city=) needs a Suspense boundary on a prerendered route
  return (
    <Suspense>
      <SurveyPage />
    </Suspense>
  );
}

function SurveyPage() {
  const trip = surveyTrip(useSearchParams());
  const { ranked } = useRecommendations();
  const { profile, weights, setProfile, setWeights, setRecs, setMode, feedback, setFeedback } = useTrip();
  const [ratings, setRatings] = useState<Partial<Record<Factor, number>>>({});
  const [liked, setLiked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { t, fmt } = useT();
  const sv = t.survey;
  const pastWindow = pastTripWindow(trip.id);
  const pastDates = pastWindow ? `${fmt.range(pastWindow)} ${pastWindow.start.slice(0, 4)}` : "";

  async function submit() {
    setBusy(true);
    const before = { weights, profile: profile ?? DEMO_PROFILE, ranking: ranked.map((r) => r.id) };
    const fb = await api.feedback({
      trip_id: trip.id,
      answers: { ...(ratings as Record<string, number>), loved: liked },
      profile: before.profile,
      weights,
    });
    setMode("feedback", fb.mode);

    // Travel DNA y2 = No: the answers are recorded, but the profile and weights stay exactly as they were,
    // whatever the backend returns. That is the promise on screen.
    if (before.profile.personalize === false) {
      const items: FeedbackDiff["items"] = {};
      for (const r of ranked) items[r.id] = { city: r.city, iata: r.iata, window: r.window, total_cost_pln: r.total_cost_pln };
      setFeedback({ tripId: trip.id, before, after: before, diff: [], items, frozen: true });
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const nextWeights = fb.data.weights ?? weights;
    const nextProfile = fb.data.profile ?? fb.data;
    const fresh = await api.recommendations({ profile: nextProfile, weights: nextWeights });
    const items: FeedbackDiff["items"] = {};
    for (const r of [...ranked, ...fresh.data])
      items[r.id] = { city: r.city, iata: r.iata, window: r.window, total_cost_pln: r.total_cost_pln };
    setProfile(nextProfile);
    setWeights(nextWeights);
    setRecs(fresh.data, { profile: nextProfile, weights: nextWeights, mode: fresh.mode });
    setFeedback({
      tripId: trip.id,
      before,
      after: { weights: nextWeights, profile: nextProfile, ranking: rerank(fresh.data, nextWeights).map((r) => r.id) },
      diff: fb.data.diff ?? [],
      items,
    });
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // a stored result is only for the trip it rated; another trip opens a fresh form
  if (feedback && feedback.tripId === trip.id) {
    const top = feedback.items[feedback.after.ranking[0]];
    const changedTop = feedback.before.ranking[0] !== feedback.after.ranking[0];
    return (
      <AppShell>
        <PageTitle eyebrow={sv.resultEyebrow} title={feedback.frozen ? sv.titleFrozen : sv.titleChanged}>
          {feedback.frozen ? sv.introFrozen(trip.city) : sv.introChanged(trip.city)}
        </PageTitle>
        {feedback.frozen && (
          <p role="status" className="mb-6 rounded-2xl border border-clay/30 bg-clay-soft p-3.5 text-sm text-ink">
            {sv.frozenNote}{" "}
            <Link href="/onboarding" className="font-medium text-pine underline-offset-2 hover:underline">
              {sv.turnOn}
            </Link>
          </p>
        )}

        {top && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.2 }}
            className="mb-6 flex items-start gap-3 rounded-2xl bg-ink p-4 text-paper shadow-lift"
          >
            <Bell className="mt-0.5 size-4 shrink-0 text-sun" />
            <p className="text-sm leading-snug">
              <span className="font-semibold">{changedTop ? sv.newTop : sv.stillTop}:</span>{" "}
              {sv.pushLine(fmt.range(top.window), top.city, fmt.pln(top.total_cost_pln))}
            </p>
          </motion.div>
        )}

        <section className="rounded-3xl border border-line bg-card p-4 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">{sv.weightsTitle}</h2>
          <WeightDiff diff={feedback} />
          <div className="mt-4 border-t border-dashed border-line pt-3">
            <ProfileDiff diff={feedback} />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-ink">{sv.rerankedTitle}</h2>
          <Rerank diff={feedback} />
        </section>

        <Button asChild size="lg" className="mt-6 h-12 w-full rounded-2xl text-base">
          <Link href="/trips">
            {sv.seeUpdated} <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
        <button
          onClick={() => setFeedback(null)}
          className="mx-auto mt-3 flex items-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-ink"
        >
          <RotateCcw className="size-3.5" /> {sv.answerAgain}
        </button>
      </AppShell>
    );
  }

  const complete = QUESTION_ORDER.every((f) => ratings[f]);

  return (
    <AppShell>
      <PageTitle eyebrow={sv.eyebrow} title={sv.title(trip.city)}>
        {sv.intro}
      </PageTitle>

      {profile?.personalize === false && (
        <div role="status" className="mb-5 rounded-2xl border border-clay/30 bg-clay-soft p-3.5 text-sm text-ink">
          <b>{sv.noTailorBold}</b>
          {sv.noTailorRest}{" "}
          <Link href="/onboarding" className="font-medium text-pine underline-offset-2 hover:underline">
            {sv.changeThat}
          </Link>
        </div>
      )}

      <CityPhoto rec={trip} className="mb-6 h-36 rounded-3xl">
        <div className="absolute bottom-3 left-4 text-white">
          <p className="font-display text-2xl leading-none">{trip.city}</p>
          <p className="mt-1 text-sm text-white/85">{pastDates}</p>
        </div>
      </CityPhoto>

      <div className="space-y-6">
        {QUESTION_ORDER.map((f) => {
          const q = sv.questions[f];
          return (
            <div key={f}>
              <p id={`q-${f}`} className="mb-2.5 text-[15px] font-medium text-ink">
                {q.q}
              </p>
              <Rating
                value={ratings[f]}
                onChange={(v) => setRatings((r) => ({ ...r, [f]: v }))}
                low={q.low}
                high={q.high}
                labelledBy={`q-${f}`}
              />
            </div>
          );
        })}
        <div>
          <p className="mb-2.5 text-[15px] font-medium text-ink">{sv.enjoyed}</p>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((tag) => {
              const on = liked.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => setLiked((l) => (on ? l.filter((x) => x !== tag) : [...l, tag]))}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm capitalize transition-colors",
                    on ? "border-pine bg-pine text-primary-foreground" : "border-line bg-card text-ink-soft",
                  )}
                >
                  {sv.tags[tag]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Button size="lg" className="mt-8 h-12 w-full rounded-2xl text-base" disabled={!complete || busy} onClick={submit}>
        {busy ? sv.submitting : sv.submit}
      </Button>
      <button
        onClick={() => {
          setRatings({ crowds: 1, weather: 2, price: 4, taste: 5 });
          setLiked(["food", "architecture"]);
        }}
        className="mx-auto mt-2 block py-2 text-xs text-muted-foreground hover:text-ink"
      >
        {sv.demoFill}
      </button>
    </AppShell>
  );
}
