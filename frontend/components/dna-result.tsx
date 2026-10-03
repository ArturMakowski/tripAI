"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Ban, Compass, Footprints, Hotel, Plane } from "lucide-react";
import { Disclosure } from "@/components/declutter";
import { WhySheet } from "@/components/why-sheet";
import { DNA_CARD, DNA_DECK, type CardId, type DnaAnswers, type DnaCard, type Lang } from "@/lib/dna";
import { citedByAnswer, likedCards, persona, priorities } from "@/lib/dna-persona";
import { messagesFor } from "@/lib/i18n";
import { nameOf } from "@/lib/i18n/messages/profile";
import type { DnaResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatOrigins } from "@/lib/airports";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** likes shown up front; the rest fold behind "+N more" */
export const TOP_LIKES = 5;

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

/** "Label: because you swiped …" lines behind the one ⓘ: the traceability stays one tap away. */
function Reasons({ rows }: { rows: { label: string; text: string }[] }) {
  const shown = rows.filter((r) => r.text);
  if (!shown.length) return null;
  return (
    <>
      {shown.map((r) => (
        <span key={r.label} className="mt-2 block first:mt-0">
          <span className="font-medium text-ink">{r.label}:</span> {r.text}
        </span>
      ))}
    </>
  );
}

const TILT = [-7, 4, -3, 6];

/** The photos the user swiped right on, as a small fanned stack. */
function Collage({ cards, label }: { cards: DnaCard[]; label: string }) {
  if (!cards.length) return null;
  return (
    <div role="img" aria-label={label} className="mt-5 flex h-36 items-center justify-center">
      {cards.map((c, i) => (
        <motion.div
          key={c.id}
          initial={{ opacity: 0, y: 16, rotate: 0 }}
          animate={{ opacity: 1, y: 0, rotate: TILT[i % TILT.length] }}
          transition={{ delay: 0.08 * i, type: "spring", stiffness: 260, damping: 22 }}
          className={cn("h-32 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-card bg-card shadow-soft", i > 0 && "-ml-4")}
          style={{ zIndex: cards.length - Math.abs(i - 1) }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.image} alt="" className="size-full object-cover" />
        </motion.div>
      ))}
    </div>
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
  const [showAll, setShowAll] = useState(false);
  const tagName = (tag: string) => nameOf(all.profile.tags, tag);
  const because = (field: string) => {
    const r = result.reasons.find((x) => x.field === field);
    return r ? becauseLine(r.because, collected, lang) : "";
  };
  const { profile, weights } = result;
  const personalize = profile.personalize !== false;

  // --- who you are: persona + the swipes behind it + the photos you liked
  const who = persona(collected);
  const title = t.persona.title(t.persona.nouns[who.noun], who.mod ? t.persona.mods[who.mod] : null);
  // "“So me!” on local food and price": the cited swipes grouped by answer
  const cited = citedByAnswer(collected, who.cited).map(([v, ids]) =>
    t.becausePart(t.answers[v as 1], t.persona.cards(ids.map((id) => DNA_CARD[id].short[lang]))),
  );
  const photos = likedCards(collected, who.cited);

  // --- what drives the ranking, as a sentence + ranked bars (no numbers)
  const order = priorities(weights);
  const max = Math.max(...order.map((f) => weights[f])) || 1;
  const factor = (f: (typeof order)[number]) => t.priorities.phrase[f];

  // --- likes: the strongest few, the rest folded
  const interests = Object.entries(profile.interests).sort((a, b) => b[1] - a[1]);
  const liked = interests.filter(([, v]) => v >= 0.25);
  const meh = interests.filter(([, v]) => v < 0.25);
  const top = liked.slice(0, TOP_LIKES);
  const rest = liked.slice(TOP_LIKES);

  const paceVal = profile.traits?.pace ?? 0;
  const paceKey = paceVal > 0.25 ? "structured" : paceVal < -0.25 ? "spontaneous" : "balanced";
  const tiles = [
    { icon: Hotel, label: t.tiles.stay, value: all.profile.luxury[profile.luxury], field: "luxury" },
    { icon: Footprints, label: t.tiles.pace, value: t.pace[paceKey], field: "traits.pace" },
    {
      icon: Compass,
      label: t.tiles.daily,
      value: profile.daily_discovery === false ? t.tiles.dailyNo : t.tiles.dailyYes,
      field: "daily_discovery",
    },
    {
      icon: Ban,
      label: t.tiles.avoid,
      value: profile.dislikes.length ? profile.dislikes.map((d) => nameOf(t.avoid, d)).join(", ") : t.tiles.none,
      field: "dislikes",
    },
  ];
  const people = (profile.adults ?? 1) + (profile.children ?? 0);

  // every derived value with the swipes behind it, behind the one ⓘ
  const reasons = [
    ...order.map((f) => ({ label: all.trips.factors[f], text: because(`weights.${f}`) })),
    ...liked.map(([tag]) => ({ label: cap(tagName(tag)), text: because(`interests.${tag}`) })),
    ...tiles.map((r) => ({ label: r.label, text: because(r.field) })),
  ];

  return (
    <div className={cn("transition-opacity", busy && "opacity-70")}>
      <p className="mt-1 text-sm font-medium text-clay">{t.resultTitle}</p>
      <h1 className="mt-1 font-display text-[2.15rem] leading-[1.05] font-medium text-ink" data-testid="dna-persona">
        {title}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{cited.length ? t.persona.why(cited) : t.persona.noWhy}</p>

      <Collage cards={photos} label={`${t.persona.photos}: ${photos.map((c) => c.short[lang]).join(", ")}`} />

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

      <section className="mt-5 rounded-3xl border border-line bg-card p-4 shadow-soft">
        <p className="text-xs text-muted-foreground">
          {t.priorities.title}{" "}
          <WhySheet label={t.whyResult} title={t.whyResult} close={t.close}>
            <Reasons rows={reasons} />
          </WhySheet>
        </p>
        <p className="mt-1 font-display text-xl leading-snug text-ink">{t.priorities.most(factor(order[0]), factor(order[1]))}</p>
        <ol className="mt-3 space-y-1.5" aria-hidden>
          {order.map((f, i) => (
            <li key={f} className="flex items-center gap-3 text-sm">
              <span className={cn("w-16 shrink-0", i === 0 ? "font-semibold text-ink" : "text-ink-soft")}>{all.trips.factorsShort[f]}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-deep">
                <motion.span
                  className={cn("block h-full rounded-full", i === 0 ? "bg-pine" : "bg-pine/45")}
                  initial={{ width: 0 }}
                  animate={{ width: `${(weights[f] / max) * 100}%` }}
                  transition={{ delay: 0.05 * i, type: "spring", stiffness: 120, damping: 20 }}
                />
              </span>
            </li>
          ))}
        </ol>
      </section>

      {liked.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-ink">{t.likes.title}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {top.map(([tag], i) => (
              <li
                key={tag}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[15px]",
                  i < 2 ? "bg-pine font-medium text-paper" : "border border-pine/30 bg-pine-soft text-pine-deep",
                )}
              >
                {cap(tagName(tag))}
              </li>
            ))}
            {showAll &&
              rest.map(([tag]) => (
                <li key={tag} className="rounded-full border border-line bg-card px-3 py-1 text-sm text-ink-soft">
                  {cap(tagName(tag))}
                </li>
              ))}
            {rest.length > 0 && !showAll && (
              <li>
                <button onClick={() => setShowAll(true)} className="rounded-full px-2 py-1.5 text-sm text-pine underline-offset-2 hover:underline">
                  {t.likes.more(rest.length)}
                </button>
              </li>
            )}
          </ul>
          {meh.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t.likes.notForYou}: {meh.map(([tag]) => tagName(tag)).join(", ")}
            </p>
          )}
        </section>
      )}

      <ul className="mt-6 grid grid-cols-2 gap-2">
        {tiles.map(({ icon: Icon, label, value }) => (
          <li key={label} className="rounded-2xl border border-line bg-card p-3">
            <Icon className="size-4 text-pine" aria-hidden />
            <p className="mt-1.5 text-xs text-muted-foreground">{label}</p>
            <p className="text-[15px] leading-snug font-medium text-ink">{cap(value)}</p>
          </li>
        ))}
      </ul>

      <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-soft">
        <Plane className="size-4 text-pine" aria-hidden />
        <span>{formatOrigins(airports, lang)}</span>
        <span aria-hidden>·</span>
        <span>{t.people(people)}</span>
        <span aria-hidden>·</span>
        <button onClick={() => onEditStep("trip")} className="font-medium text-pine underline-offset-2 hover:underline">
          {t.change}
        </button>
      </p>

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
