"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Ban, MessageCircle, Plane } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DnaDeck } from "@/components/dna-deck";
import { DnaResult } from "@/components/dna-result";
import { PartyPicker } from "@/components/money";
import { partySize } from "@/lib/money";
import { AppShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { api, USER_ID } from "@/lib/api";
import { collectAnswers, DNA_DECK, STATEMENT_ANSWER, YESNO_ANSWER, type DnaCard, type Gesture } from "@/lib/dna";
import { useT } from "@/lib/i18n";
import { useHydrated, useTrip, type DeckStep } from "@/lib/store";
import { useUsableRanges } from "@/lib/windows-store";
import { QuickDates } from "@/components/date-picker/free-dates-planner";
import { cn } from "@/lib/utils";

const AIRPORTS = ["KRK", "KTW", "WAW", "WMI", "GDN", "WRO", "POZ", "RZE"] as const;


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
  const { swipes, airports, result } = deck;
  // Saved state from the old order (deck → budget → airports) lands on the first step.
  const step: DeckStep = ["budget", "airport"].includes(deck.step as string) ? "trip" : deck.step;
  const ranges = useUsableRanges();
  const { t: all, lang } = useT();
  const t = all.onboarding;
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  // position = number of distinct cards answered in deck order (undo pops the last swipe)
  const position = Math.min(swipes.length, DNA_DECK.length);
  const collected = useMemo(() => collectAnswers(swipes), [swipes]);

  function answer(card: DnaCard, g: Gesture) {
    const value = card.kind === "yesno" ? YESNO_ANSWER[g] : STATEMENT_ANSWER[g];
    if (value === undefined) return;
    const next = [...swipes, { id: card.id, value }];
    setDeck({ swipes: next });
    // Let the last card fly out first; undo within that moment cancels the jump.
    if (next.length >= DNA_DECK.length)
      advance.current = setTimeout(() => {
        setDeck({ step: "result" });
        void compute(collectAnswers(next));
      }, 380);
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

  /** Answers -> POST /profile/dna (fixture fallback); stale responses are dropped. */
  async function compute(edited = collected) {
    const id = ++reqId.current;
    setBusy(true);
    const { data, mode } = await api.profileDna({
      user_id: USER_ID,
      answers: edited.answers as Record<string, number>,
      yes_no: edited.yes_no as Record<string, boolean>,
    });
    if (id !== reqId.current) return false;
    setMode("interview", mode);
    setDeck({ result: data });
    setBusy(false);
    return true;
  }

  function edit(cardId: string, value: number | boolean) {
    const next = [...swipes.filter((s) => s.id !== cardId), { id: cardId as DnaCard["id"], value }];
    // keep deck order so "position" stays meaningful
    next.sort((a, b) => DNA_DECK.findIndex((c) => c.id === a.id) - DNA_DECK.findIndex((c) => c.id === b.id));
    setDeck({ swipes: next });
    compute(collectAnswers(next));
  }

  function finish() {
    if (!result) return;
    // Price sensitivity comes from DNA q9/q10; a hard "never over X" limit is optional and lives in Profile.
    setProfile({
      ...result.profile,
      budget_pln: profile?.budget_pln ?? null,
      origin_airports: airports.length ? airports : ["KRK"],
      // party size from the airport step; flights are priced × travellers, the stay per room
      adults: deck.party ?? profile?.adults ?? 1,
      children: deck.party != null ? 0 : (profile?.children ?? 0),
      rooms: null,
    });
    setWeights(result.weights);
    // dates were picked on the first step: straight to trips; otherwise the calendar
    router.push(ranges.length ? "/trips" : "/windows");
  }

  function restart() {
    setDeck({ swipes: [], step: "trip", result: null });
  }

  if (!hydrated) return <AppShell nav={false}>{null}</AppShell>;

  return (
    <AppShell back="/" title={t.eyebrow} nav={false}>
      <AnimatePresence mode="wait">
        {step === "swipe" && (
          <motion.section key="swipe" {...slide} className="flex flex-col pt-1 pb-6">
            <Dots total={DNA_DECK.length} done={position} />
            <h1 className="mt-4 text-center font-display text-[1.6rem] leading-tight text-ink">{t.title}</h1>
            <p className="mt-1 mb-4 text-center text-xs text-muted-foreground">
              {DNA_DECK[position]?.kind === "yesno" ? t.hintYesNo : t.hint}
            </p>
            <DnaDeck cards={DNA_DECK} position={position} lang={lang} onAnswer={answer} onUndo={undo} undoGesture={undoGesture} />
            {position === 0 && (
              <button onClick={() => setDeck({ step: "trip" })} className="mt-5 text-center text-sm text-muted-foreground hover:text-ink">
                ← {t.back}
              </button>
            )}
            <Link
              href="/onboarding/chat"
              className="mt-6 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-ink"
            >
              <MessageCircle className="size-4" /> {t.preferChat}
            </Link>
          </motion.section>
        )}

        {step === "trip" && (
          <motion.section key="trip" {...slide} className="flex min-h-[70dvh] flex-col pt-4 pb-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-clay uppercase">{t.step(1, 2)}</p>
            <h1 className="mt-1 font-display text-[2rem] leading-tight text-ink">{t.tripTitle}</h1>
            <p className="mt-1 text-[15px] text-ink-soft">{t.tripSub}</p>

            <h2 className="mt-6 text-sm font-semibold text-ink">{t.datesLabel}</h2>
            <div className="mt-2">
              <QuickDates />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t.datesHint}</p>

            <PartyPicker className="mt-6" value={deck.party ?? partySize(profile)} onChange={(n) => setDeck({ party: n })} />

            <h2 className="mt-6 text-sm font-semibold text-ink">{t.airportTitle}</h2>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {AIRPORTS.map((code) => {
                const on = airports.includes(code);
                return (
                  <motion.button
                    key={code}
                    whileTap={{ scale: 0.97 }}
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${code} ${t.airports[code]}`}
                    title={t.airports[code]}
                    onClick={() => setDeck({ airports: on ? airports.filter((a) => a !== code) : [...airports, code] })}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-xl border py-2.5 font-mono text-sm font-semibold transition-colors",
                      on ? "border-pine bg-pine text-primary-foreground shadow-soft" : "border-line bg-card text-ink",
                    )}
                  >
                    <Plane className={cn("size-3.5", on ? "text-paper" : "text-pine")} aria-hidden />
                    {code}
                  </motion.button>
                );
              })}
            </div>

            <div className="mt-auto pt-8">
              <Button
                size="lg"
                className="h-12 w-full rounded-2xl text-base"
                disabled={!airports.length || busy}
                onClick={async () => {
                  // Coming back from the result (edit): the deck is already done, recompute instead.
                  if (swipes.length >= DNA_DECK.length) {
                    if (await compute()) setDeck({ step: "result" });
                  } else setDeck({ step: "swipe" });
                }}
              >
                {busy ? t.computing : t.next} {!busy && <ArrowRight data-icon="inline-end" />}
              </Button>
            </div>
          </motion.section>
        )}

        {step === "result" && (
          <motion.section key="result" {...slide} className="pt-3 pb-10">
            {result ? (
              <DnaResult
                result={result}
                collected={collected}
                lang={lang}
                busy={busy}
                airports={airports}
                onEdit={edit}
                onEditStep={(s) => setDeck({ step: s })}
              />
            ) : (
              // Older saved state can land here without a result: offer a way forward instead of a dead end.
              <div className="py-24 text-center">
                <p className="text-sm text-muted-foreground">{busy ? t.computing : t.resultMissing}</p>
                {!busy && (
                  <Button className="mt-4 rounded-2xl" onClick={() => compute()}>
                    {t.showDna}
                  </Button>
                )}
              </div>
            )}
            {result && (
              <>
                <div className="mt-6 flex items-center justify-center gap-4 text-sm">
                  <Link href="/onboarding/chat" className="flex items-center gap-1.5 text-pine underline-offset-2 hover:underline">
                    <MessageCircle className="size-4" aria-hidden /> {t.chat}
                  </Link>
                  <button onClick={restart} className="flex items-center gap-1.5 text-muted-foreground hover:text-ink">
                    <Ban className="size-3.5" aria-hidden /> {t.restart}
                  </button>
                </div>
                {/* One primary action, always visible. */}
                <div className="sticky bottom-0 -mx-5 mt-4 border-t border-line bg-paper/90 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.9rem)] backdrop-blur-md">
                  <Button size="lg" className="h-12 w-full rounded-2xl text-base" onClick={finish} disabled={busy}>
                    {t.continue} <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
