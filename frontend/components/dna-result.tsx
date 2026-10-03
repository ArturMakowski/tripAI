"use client";

import { motion } from "motion/react";
import { Ban, Compass, Footprints, Hotel, Pencil, Plane } from "lucide-react";
import { Disclosure, InfoTip } from "@/components/declutter";
import { FACTOR_COLOR } from "@/components/factor-bars";
import { DNA_CARD, DNA_DECK, type CardId, type DnaAnswers, type Lang } from "@/lib/dna";
import { messagesFor } from "@/lib/i18n";
import { nameOf } from "@/lib/i18n/messages/profile";
import { FACTORS } from "@/lib/scoring";
import type { DnaResponse } from "@/lib/types";
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

/** "Label: because you swiped …" lines behind an ⓘ: the traceability stays one tap away. */
function Reasons({ rows }: { rows: { label: string; text: string }[] }) {
  const shown = rows.filter((r) => r.text);
  if (!shown.length) return null;
  return (
    <>
      {shown.map((r) => (
        <span key={r.label} className="mt-1 block first:mt-0">
          <span className="font-medium text-ink-soft">{r.label}:</span> {r.text}
        </span>
      ))}
    </>
  );
}

function Section({ title, info, infoLabel, children }: { title: string; info?: React.ReactNode; infoLabel?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-3">
        <h2 className="inline text-xs font-semibold tracking-[0.14em] text-clay uppercase">{title}</h2>
        {info && (
          <>
            {" "}
            <InfoTip label={infoLabel}>{info}</InfoTip>
          </>
        )}
      </div>
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
  airports,
  onEdit,
  onEditStep,
}: {
  result: DnaResponse;
  collected: DnaAnswers;
  lang: Lang;
  busy: boolean;
  airports: string[];
  onEdit: (cardId: string, value: number | boolean) => void;
  onEditStep: (step: "trip") => void;
}) {
  const all = messagesFor(lang);
  const t = all.onboarding;
  const tagName = (tag: string) => nameOf(all.profile.tags, tag);
  const s = t.styleRows;
  const because = (field: string) => {
    const r = result.reasons.find((x) => x.field === field);
    return r ? becauseLine(r.because, collected, lang) : "";
  };
  const { profile, weights } = result;
  const personalize = profile.personalize !== false;
  const interests = Object.entries(profile.interests).sort((a, b) => b[1] - a[1]);
  const liked = interests.filter(([, v]) => v >= 0.25);
  const meh = interests.filter(([, v]) => v < 0.25);
  const pace = profile.traits?.pace ?? 0;
  const paceKey = pace > 0.25 ? "structured" : pace < -0.25 ? "spontaneous" : "balanced";
  const total = FACTORS.reduce((a, f) => a + weights[f], 0) || 1;

  const styleRows = [
    { icon: Hotel, label: s.luxury, value: all.profile.luxury[profile.luxury], field: "luxury" },
    { icon: Footprints, label: s.pace, value: t.pace[paceKey], field: "traits.pace" },
    {
      icon: Compass,
      label: s.daily,
      value: profile.daily_discovery == null ? "–" : profile.daily_discovery ? s.yes : s.no,
      field: "daily_discovery",
    },
    {
      icon: Ban,
      label: s.avoid,
      value: profile.dislikes.length ? profile.dislikes.map((d) => nameOf(t.avoid, d)).join(", ") : s.none,
      field: "dislikes",
    },
  ];

  return (
    <div className={cn("transition-opacity", busy && "opacity-70")}>
      <p className="sr-only">{t.eyebrow}</p>
      <h1 className="mt-1 font-display text-[2rem] leading-[1.08] font-medium text-ink">{t.resultTitle}</h1>

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

      <Section
        title={t.weights}
        infoLabel={t.whyWeights}
        info={<Reasons rows={FACTORS.map((f) => ({ label: all.trips.factors[f], text: because(`weights.${f}`) }))} />}
      >
        {/* One stacked bar: each factor's share of the ranking. */}
        <div className="rounded-3xl border border-line bg-card p-4 shadow-soft">
          <div className="flex h-3 overflow-hidden rounded-full bg-paper-deep" aria-hidden>
            {FACTORS.map((f, i) => (
              <motion.span
                key={f}
                className="h-full"
                style={{ background: FACTOR_COLOR[f] }}
                initial={{ width: 0 }}
                animate={{ width: `${(weights[f] / total) * 100}%` }}
                transition={{ delay: 0.05 * i, type: "spring", stiffness: 120, damping: 20 }}
              />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {FACTORS.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: FACTOR_COLOR[f] }} aria-hidden />
                <span className="flex-1 text-ink-soft">{all.trips.factorsShort[f]}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section
        title={t.interests}
        infoLabel={t.whyInterests}
        info={<Reasons rows={liked.map(([tag]) => ({ label: cap(tagName(tag)), text: because(`interests.${tag}`) }))} />}
      >
        {/* Chips without numbers: strength shows as fill. */}
        <ul className="flex flex-wrap gap-2">
          {liked.map(([tag, v]) => (
            <li
              key={tag}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm",
                v >= 0.75 ? "border-pine bg-pine text-paper" : v >= 0.5 ? "border-pine/30 bg-pine-soft text-pine-deep" : "border-line bg-card text-ink-soft",
              )}
            >
              {cap(tagName(tag))}
            </li>
          ))}
        </ul>
        {meh.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {s.notForYou}: {meh.map(([tag]) => tagName(tag)).join(", ")}
          </p>
        )}
      </Section>

      <Section
        title={t.style}
        infoLabel={t.whyStyle}
        info={<Reasons rows={styleRows.map((r) => ({ label: r.label, text: because(r.field) }))} />}
      >
        <ul className="divide-y divide-line rounded-3xl border border-line bg-card px-4 shadow-soft">
          {styleRows.map(({ icon: Icon, label, value }) => (
            <li key={label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="flex items-center gap-2 text-ink-soft">
                <Icon className="size-4 text-pine" /> {label}
              </span>
              <span className="font-medium text-ink">{cap(value)}</span>
            </li>
          ))}
                    <li className="flex items-center justify-between py-2.5 text-sm">
            <span className="flex items-center gap-2 text-ink-soft">
              <Plane className="size-4 text-pine" /> {s.from}
            </span>
            <button onClick={() => onEditStep("trip")} className="flex items-center gap-1.5 font-mono font-medium text-ink">
              {airports.join(", ")}
              <Pencil className="size-3.5 text-muted-foreground" aria-label={s.change} />
            </button>
          </li>
        </ul>
      </Section>

      <Disclosure title={t.editAnswers} count={DNA_DECK.length} hint={t.editHint} className="mt-6">
        <ul className="space-y-2">
          {DNA_DECK.map((card) => (
            <li key={card.id} className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-2.5 pr-3">
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
      </Disclosure>
    </div>
  );
}
