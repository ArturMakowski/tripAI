"use client";

import { motion } from "motion/react";
import { Ban, Compass, Footprints, Hotel, Pencil, Plane, Sparkles, Wallet } from "lucide-react";
import { FACTOR_COLOR, FACTOR_ICON } from "@/components/factor-bars";
import { DNA_CARD, DNA_DECK, type CardId, type DnaAnswers, type Lang } from "@/lib/dna";
import { fmtFor, messagesFor } from "@/lib/i18n";
import { nameOf } from "@/lib/i18n/messages/profile";
import { FACTORS } from "@/lib/scoring";
import type { DnaReason, DnaResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Server reason -> "because you swiped “So me!” on price driving your choices, “Not me” on …" */
export function becauseLine(because: string[], collected: DnaAnswers, lang: Lang): string {
  const parts = because
    .map((id) => DNA_CARD[id as CardId])
    .filter(Boolean)
    .map((card) => {
      const t = messagesFor(lang).onboarding;
      let label: string;
      if (card.kind === "yesno") {
        const v = collected.yes_no[card.id as "y1" | "y2"];
        label = v == null ? "–" : v ? t.yesNo.yes : t.yesNo.no;
      } else {
        const v = collected.answers[card.id] ?? 3;
        label = t.answers[v as 1 | 2 | 3 | 4 | 5];
      }
      return t.becausePart(label, card.short[lang]);
    });
  if (!parts.length) return "";
  return messagesFor(lang).onboarding.because(parts.join(", "));
}

function Why({ reason, collected, lang }: { reason?: DnaReason; collected: DnaAnswers; lang: Lang }) {
  if (!reason) return null;
  return <p className="mt-1 text-xs leading-snug text-muted-foreground">{becauseLine(reason.because, collected, lang)}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-xs font-semibold tracking-[0.14em] text-clay uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** 1..5 dot scale (radiogroup) for one statement card. */
function DotScale({ id, value, lang, onChange }: { id: CardId; value?: number; lang: Lang; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-labelledby={`dna-${id}`} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n}: ${messagesFor(lang).onboarding.answers[n as 1]}`}
          title={messagesFor(lang).onboarding.answers[n as 1]}
          onClick={() => onChange(n)}
          className="grid size-9 place-items-center rounded-full"
        >
          <motion.span
            className="block rounded-full"
            animate={{
              width: value === n ? 16 : 10,
              height: value === n ? 16 : 10,
              backgroundColor: value != null && n <= value ? "var(--pine)" : "var(--line)",
            }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        </button>
      ))}
    </div>
  );
}

export function DnaResult({
  result,
  collected,
  lang,
  busy,
  budget,
  airports,
  onEdit,
  onEditStep,
}: {
  result: DnaResponse;
  collected: DnaAnswers;
  lang: Lang;
  busy: boolean;
  budget: number | null;
  airports: string[];
  onEdit: (cardId: string, value: number | boolean) => void;
  onEditStep: (step: "budget" | "airport") => void;
}) {
  const all = messagesFor(lang);
  const t = all.onboarding;
  const fmt = fmtFor(lang);
  const tagName = (tag: string) => nameOf(all.profile.tags, tag);
  const s = t.styleRows;
  const reason = (field: string) => result.reasons.find((r) => r.field === field);
  const { profile, weights } = result;
  const personalize = profile.personalize !== false;
  const interests = Object.entries(profile.interests).sort((a, b) => b[1] - a[1]);
  const liked = interests.filter(([, v]) => v >= 0.25);
  const meh = interests.filter(([, v]) => v < 0.25);
  const pace = profile.traits?.pace ?? 0;
  const paceKey = pace > 0.25 ? "structured" : pace < -0.25 ? "spontaneous" : "balanced";

  return (
    <div className={cn("transition-opacity", busy && "opacity-70")}>
      <p className="text-xs font-semibold tracking-[0.14em] text-clay uppercase">{t.eyebrow}</p>
      <h1 className="mt-1 font-display text-[2rem] leading-[1.08] font-medium text-ink">{t.resultTitle}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{t.resultSub}</p>

      {!personalize && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          className="mt-5 flex gap-3 rounded-3xl border border-clay/30 bg-clay-soft p-4"
        >
          <Ban className="mt-0.5 size-5 shrink-0 text-clay" />
          <div>
            <p className="font-semibold text-ink">{t.noTailorTitle}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink">{t.noTailor}</p>
          </div>
        </motion.div>
      )}

      <Section title={t.weights}>
        <ul className="space-y-4 rounded-3xl border border-line bg-card p-4 shadow-soft">
          {FACTORS.map((f, i) => {
            const Icon = FACTOR_ICON[f];
            return (
              <li key={f}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <Icon className="size-4" style={{ color: FACTOR_COLOR[f] }} /> {all.trips.factors[f]}
                  </span>
                  <span className="tabular font-mono text-ink">{Math.round(weights[f] * 100)}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-deep">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: FACTOR_COLOR[f] }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(weights[f] / Math.max(...FACTORS.map((x) => weights[x]))) * 100}%` }}
                    transition={{ delay: 0.05 * i, type: "spring", stiffness: 120, damping: 20 }}
                  />
                </div>
                <Why reason={reason(`weights.${f}`)} collected={collected} lang={lang} />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t.interests}>
        <ul className="space-y-3">
          {liked.map(([tag, v]) => (
            <li key={tag} className="rounded-2xl border border-line bg-card px-4 py-3 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{cap(tagName(tag))}</span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-paper-deep">
                    <motion.span
                      className="block h-full rounded-full bg-pine"
                      initial={{ width: 0 }}
                      animate={{ width: `${v * 100}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    />
                  </span>
                  <span className="tabular w-9 text-right font-mono text-sm text-ink">{v.toFixed(2)}</span>
                </span>
              </div>
              <Why reason={reason(`interests.${tag}`)} collected={collected} lang={lang} />
            </li>
          ))}
        </ul>
        {meh.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {s.notForYou}: {meh.map(([tag]) => tagName(tag)).join(", ")}
          </p>
        )}
      </Section>

      <Section title={t.style}>
        <ul className="divide-y divide-line rounded-3xl border border-line bg-card px-4 shadow-soft">
          {[
            { icon: Hotel, label: s.luxury, value: all.profile.luxury[profile.luxury], r: reason("luxury") },
            { icon: Footprints, label: s.pace, value: t.pace[paceKey], r: reason("traits.pace") },
            {
              icon: Compass,
              label: s.daily,
              value: profile.daily_discovery == null ? "–" : profile.daily_discovery ? s.yes : s.no,
              r: reason("daily_discovery"),
            },
            {
              icon: Ban,
              label: s.avoid,
              value: profile.dislikes.length ? profile.dislikes.map((d) => nameOf(t.avoid, d)).join(", ") : s.none,
              r: reason("dislikes"),
            },
          ].map(({ icon: Icon, label, value, r }) => (
            <li key={label} className="py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-ink-soft">
                  <Icon className="size-4 text-pine" /> {label}
                </span>
                <span className="font-medium text-ink">{cap(value)}</span>
              </div>
              <Why reason={r} collected={collected} lang={lang} />
            </li>
          ))}
          <li className="py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-ink-soft">
                <Wallet className="size-4 text-pine" /> {s.budget}
              </span>
              <button onClick={() => onEditStep("budget")} className="flex items-center gap-1.5 font-medium text-ink">
                {budget == null ? s.flexible : fmt.pln(budget)}
                <Pencil className="size-3.5 text-muted-foreground" aria-label={s.change} />
              </button>
            </div>
          </li>
          <li className="py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-ink-soft">
                <Plane className="size-4 text-pine" /> {s.from}
              </span>
              <button onClick={() => onEditStep("airport")} className="flex items-center gap-1.5 font-mono font-medium text-ink">
                {airports.join(", ")}
                <Pencil className="size-3.5 text-muted-foreground" aria-label={s.change} />
              </button>
            </div>
          </li>
        </ul>
      </Section>

      <Section title={t.answersTitle}>
        <p className="-mt-1 mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" />
          {t.editHint}
        </p>
        <ul className="space-y-2">
          {DNA_DECK.map((card) => (
            <li key={card.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-2.5 pr-3 shadow-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={card.image} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p id={`dna-${card.id}`} className="text-[13px] leading-snug text-ink">
                  {card.text[lang]}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  {card.kind === "statement" ? (
                    <>
                      <DotScale id={card.id} value={collected.answers[card.id]} lang={lang} onChange={(v) => onEdit(card.id, v)} />
                      <span className="text-xs text-muted-foreground">
                        {t.answers[(collected.answers[card.id] ?? 3) as 1]}
                      </span>
                    </>
                  ) : (
                    <div role="radiogroup" aria-labelledby={`dna-${card.id}`} className="flex gap-1.5">
                      {([true, false] as const).map((v) => {
                        const on = collected.yes_no[card.id as "y1" | "y2"] === v;
                        return (
                          <button
                            key={String(v)}
                            role="radio"
                            aria-checked={on}
                            onClick={() => onEdit(card.id, v)}
                            className={cn(
                              "rounded-full border px-3 py-0.5 text-xs font-semibold",
                              on ? (v ? "border-pine bg-pine text-paper" : "border-clay bg-clay text-paper") : "border-line text-ink-soft",
                            )}
                          >
                            {v ? t.yesNo.yes : t.yesNo.no}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
