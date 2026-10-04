"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { collectAnswers, DNA_CARD, type DnaAnswers, type Lang, type DnaSwipe } from "@/lib/dna";
import { citedByAnswer, likedCards, persona, priorities } from "@/lib/dna-persona";
import { messagesFor, useT } from "@/lib/i18n";
import { useHydrated, useTrip } from "@/lib/store";
import type { Weights } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The card's text from the swipes and the current weights: persona title, the ranking line, the swipes behind it. */
export function personaSummary(collected: DnaAnswers, weights: Weights, lang: Lang) {
  const t = messagesFor(lang).onboarding;
  const who = persona(collected);
  const order = priorities(weights);
  const cited = citedByAnswer(collected, who.cited).map(([v, ids]) =>
    t.becausePart(t.answers[v as 1], t.persona.cards(ids.map((id) => DNA_CARD[id].short[lang]))),
  );
  return {
    title: t.persona.title(t.persona.nouns[who.noun], who.mod ? t.persona.mods[who.mod] : null),
    // "Price matters most, then the weather.": how the list below is ordered
    line: t.priorities.most(t.priorities.phrase[order[0]], t.priorities.phrase[order[1]]),
    why: cited.length ? t.persona.why(cited) : t.persona.noWhy,
    photo: likedCards(collected, who.cited)[0]?.image ?? null,
  };
}

/**
 * T19: the Travel DNA result as a compact card on top of /trips instead of a stop before it. Persona title +
 * one line; tap to see the swipes behind it, ✕ to hide it (the full result, with editing, is in Profile).
 */
export function PersonaCard({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const swipes = useTrip((s) => s.deck.swipes);
  const hasResult = useTrip((s) => s.deck.result != null);
  const hidden = useTrip((s) => s.personaHidden);
  if (!hydrated || !hasResult || hidden || !swipes.length) return null;
  return <PersonaCardView swipes={swipes} className={className} />;
}

export function PersonaCardView({ swipes, className }: { swipes: DnaSwipe[]; className?: string }) {
  const { t: all, lang } = useT();
  const t = all.onboarding.personaCard;
  const weights = useTrip((s) => s.weights);
  const setHidden = useTrip((s) => s.setPersonaHidden);
  const [open, setOpen] = useState(false);
  const panel = useId();
  const p = useMemo(() => personaSummary(collectAnswers(swipes), weights, lang), [swipes, weights, lang]);
  return (
    <section
      aria-label={t.label}
      data-testid="persona-card"
      className={cn("rounded-2xl border border-line bg-card px-3 py-2.5 shadow-soft", className)}
    >
      <div className="flex items-center gap-3">
        {p.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photo} alt="" className="size-11 shrink-0 rounded-xl object-cover" />
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panel}
          title={open ? t.less : t.more}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg leading-tight text-ink">{p.title}</span>
            <span className="block text-[13px] leading-snug text-ink-soft">{p.line}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-pine transition-transform", open && "rotate-180")} aria-hidden />
          <span className="sr-only">{open ? t.less : t.more}</span>
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label={t.hide}
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-paper-deep hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panel}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <p className="pt-2 text-[13px] leading-snug text-ink-soft">{p.why}</p>
            <Link href="/profile#dna" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-pine hover:underline">
              {t.full} ›
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
