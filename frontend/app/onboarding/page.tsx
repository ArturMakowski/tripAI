"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DnaDeck } from "@/components/dna-deck";
import { partySize } from "@/lib/money";
import { AppShell } from "@/components/shell";
import { TripConfirm } from "@/components/trip-confirm";
import { api, USER_ID } from "@/lib/api";
import { collectAnswers, DNA_DECK, STATEMENT_ANSWER, YESNO_ANSWER, type DnaCard, type Gesture } from "@/lib/dna";
import { confirmPrefill, profileFromDna } from "@/lib/first-run";
import type { DateRange } from "@/lib/date-range";
import { useDatesHydrated } from "@/components/date-picker/free-dates-planner";
import { useT } from "@/lib/i18n";
import { useHydrated, useTrip, type DeckStep } from "@/lib/store";
import { todayISO, useDates } from "@/lib/windows-store";
import { useWindows } from "@/lib/windows";

function Dots({ total, done }: { total: number; done: number }) {
  return (
    <div
      className="flex items-center justify-center gap-1.5"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} / ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <motion.span
          key={i}
          className="h-1.5 rounded-full"
          animate={{
            width: i === done ? 18 : 6,
            backgroundColor: i < done ? "var(--pine)" : i === done ? "var(--clay)" : "var(--line)",
          }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      ))}
    </div>
  );
}

const slide = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
  transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] },
} as const;

export default function SwipeOnboarding() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { deck, setDeck, profile, setProfile, setWeights, setMode } = useTrip();
  const { swipes, airports } = deck;
  // Saved state from older flows (budget/airport steps, the result stop before T19) lands on the confirm once the
  // deck is done, and back on the deck while it isn't (no wasted "Show trips" tap to get there).
  const step: DeckStep = deck.step === "swipe" || swipes.length < DNA_DECK.length ? "swipe" : "trip";
  // the long-weekend radar loads while the user swipes, so the confirm can preselect the next one
  const { longWeekends } = useWindows();
  const datesHydrated = useDatesHydrated();
  // the range this screen pre-filled itself (only that one is ever replaced; the user's own choice stands)
  const auto = useRef<DateRange | null>(null);

  // On the confirm: pre-fill the next long weekend unless the user has dates; also for state saved before T19
  // (which skipped the last-swipe moment), and again if the radar lands later with a different next one.
  useEffect(() => {
    if (step !== "trip" || !datesHydrated) return;
    const { ranges, pickQuick } = useDates.getState();
    const next = confirmPrefill(ranges, longWeekends, todayISO(), auto.current);
    if (!next) return;
    pickQuick("long", next);
    auto.current = next;
  }, [step, datesHydrated, longWeekends]);
  const { t: all, lang } = useT();
  const t = all.onboarding;
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);

  // position = number of distinct cards answered in deck order (undo pops the last swipe)
  const position = Math.min(swipes.length, DNA_DECK.length);

  function answer(card: DnaCard, g: Gesture) {
    const value = card.kind === "yesno" ? YESNO_ANSWER[g] : STATEMENT_ANSWER[g];
    if (value === undefined) return;
    const next = [...swipes, { id: card.id, value }];
    setDeck({ swipes: next });
    if (next.length < DNA_DECK.length) return;
    // Deck done: let the last card fly out before the confirm (undo within that moment cancels the jump);
    // the confirm pre-fills the dates as it opens.
    advance.current = setTimeout(() => setDeck({ step: "trip" }), 380);
  }

  function undo() {
    if (advance.current) clearTimeout(advance.current);
    advance.current = null;
    if (!swipes.length) return;
    setDeck({ swipes: swipes.slice(0, -1), step: "swipe" });
  }

  // Direction the most recent answer left in, so undo flies that card back from the same side.
  const prev = swipes[swipes.length - 1];
  const undoGesture: Gesture | null = !prev
    ? null
    : DNA_DECK.find((c) => c.id === prev.id)?.kind === "yesno"
      ? prev.value
        ? "right"
        : "left"
      : ((Object.entries(STATEMENT_ANSWER).find(([, v]) => v === prev.value)?.[0] ?? "down") as Gesture);

  /** "Pokaż wyjazdy": answers -> POST /profile/dna (fixture fallback), applied at once, then the ranked trips. */
  async function showTrips() {
    // Not finished swiping yet (e.g. old saved state): back to the deck first.
    if (swipes.length < DNA_DECK.length) return setDeck({ step: "swipe" });
    setBusy(true);
    const collected = collectAnswers(swipes);
    let res: Awaited<ReturnType<typeof api.profileDna>>;
    try {
      res = await api.profileDna({
        user_id: USER_ID,
        answers: collected.answers as Record<string, number>,
        yes_no: collected.yes_no as Record<string, boolean>,
      });
    } catch {
      return setBusy(false); // the button comes back; nothing was applied
    }
    const { data, mode } = res;
    setMode("interview", mode);
    // the persona card on /trips shows again for a new result
    useTrip.getState().setPersonaHidden(false);
    setDeck({ result: data });
    setProfile(profileFromDna(data, profile, { airports, party: deck.party ?? partySize(profile) }));
    setWeights(data.weights);
    // fast results show at once on /trips (two-phase load); picked or pre-filled dates go with the request
    router.push("/trips");
  }

  if (!hydrated) return <AppShell nav={false}>{null}</AppShell>;

  return (
    <AppShell back="/" title={t.eyebrow} nav={false}>
      <AnimatePresence mode="wait">
        {step === "swipe" && (
          <motion.section key="swipe" {...slide} className="flex flex-col pt-1 pb-6">
            <Dots total={DNA_DECK.length} done={position} />
            <h1 className="mt-4 text-center font-display text-[1.6rem] leading-tight text-balance text-ink">{t.title}</h1>
            <p className="mt-1 mb-4 text-center text-xs text-muted-foreground">
              {DNA_DECK[position]?.kind === "yesno" ? t.hintYesNo : t.hint}
            </p>
            <DnaDeck cards={DNA_DECK} position={position} lang={lang} onAnswer={answer} onUndo={undo} undoGesture={undoGesture} />
            <Link
              href="/onboarding/chat"
              className="mt-6 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-ink"
            >
              <MessageCircle className="size-4" /> {t.preferChat}
            </Link>
          </motion.section>
        )}

        {step === "trip" && (
          <motion.section key="trip" {...slide}>
            <TripConfirm
              party={deck.party ?? partySize(profile)}
              onParty={(n) => setDeck({ party: n })}
              airports={airports}
              onAirports={(next) => setDeck({ airports: next })}
              busy={busy}
              onBack={() => setDeck({ step: "swipe", swipes: swipes.slice(0, -1) })}
              onConfirm={showTrips}
            />
          </motion.section>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
