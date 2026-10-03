"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Ban, MessageCircle, Plane, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DnaDeck } from "@/components/dna-deck";
import { DnaResult } from "@/components/dna-result";
import { AppShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { api, USER_ID } from "@/lib/api";
import { collectAnswers, DNA_DECK, STATEMENT_ANSWER, UI, YESNO_ANSWER, type DnaCard, type Gesture, type Lang } from "@/lib/dna";
import { useHydrated, useTrip } from "@/lib/store";
import { cn } from "@/lib/utils";

const AIRPORTS: [string, string][] = [
  ["KRK", "Kraków"],
  ["KTW", "Katowice"],
  ["WAW", "Warszawa"],
  ["WMI", "Modlin"],
  ["GDN", "Gdańsk"],
  ["WRO", "Wrocław"],
  ["POZ", "Poznań"],
  ["RZE", "Rzeszów"],
];
const BUDGET_MAX = 6000;
const fmtPLN = (n: number) => `${new Intl.NumberFormat("pl-PL").format(n)} zł`;

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex rounded-full border border-line bg-card p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Language">
      {(["pl", "en"] as const).map((l) => (
        <button
          key={l}
          role="radio"
          aria-checked={lang === l}
          onClick={() => onChange(l)}
          className={cn("rounded-full px-2.5 py-1 uppercase transition-colors", lang === l ? "bg-ink text-paper" : "text-muted-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

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
  const { deck, setDeck, setProfile, setWeights, setMode } = useTrip();
  const { swipes, step, budget, airports, lang, result } = deck;
  const t = UI[lang];
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
    if (next.length >= DNA_DECK.length) advance.current = setTimeout(() => setDeck({ step: "budget" }), 380);
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
    setProfile({ ...result.profile, budget_pln: budget, origin_airports: airports.length ? airports : ["KRK"] });
    setWeights(result.weights);
    router.push("/windows");
  }

  function restart() {
    setDeck({ swipes: [], step: "swipe", result: null });
  }

  if (!hydrated) return <AppShell nav={false}>{null}</AppShell>;

  return (
    <AppShell back="/" title={t.eyebrow} nav={false} action={<LangToggle lang={lang} onChange={(l) => setDeck({ lang: l })} />}>
      <AnimatePresence mode="wait">
        {step === "swipe" && (
          <motion.section key="swipe" {...slide} className="flex flex-col pt-1 pb-6">
            <Dots total={DNA_DECK.length} done={position} />
            <h1 className="mt-4 text-center font-display text-[1.6rem] leading-tight text-ink">{t.title}</h1>
            <p className="mt-1 mb-4 text-center text-xs text-muted-foreground">
              {DNA_DECK[position]?.kind === "yesno" ? t.hintYesNo : t.hint}
            </p>
            <DnaDeck cards={DNA_DECK} position={position} lang={lang} onAnswer={answer} onUndo={undo} undoGesture={undoGesture} />
            <Link
              href="/onboarding/chat"
              className="mt-6 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-ink"
            >
              <MessageCircle className="size-4" /> {lang === "pl" ? "Wolisz rozmowę? Porozmawiaj z TripAI" : "Prefer talking? Chat with TripAI"}
            </Link>
          </motion.section>
        )}

        {step === "budget" && (
          <motion.section key="budget" {...slide} className="flex min-h-[70dvh] flex-col pt-6 pb-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-clay uppercase">2 / 3</p>
            <h1 className="mt-1 font-display text-[2rem] leading-tight text-ink">{t.budgetTitle}</h1>
            <p className="mt-2 text-[15px] text-ink-soft">{t.budgetSub}</p>
            <motion.p
              key={budget ?? "flex"}
              initial={{ scale: 0.96, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              className="tabular mt-10 text-center font-display text-[3.4rem] leading-none text-ink"
            >
              {budget == null ? t.flexible : fmtPLN(budget)}
            </motion.p>
            <Slider
              className="mt-8 py-2 [&_[data-slot=slider-thumb]]:size-7 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-pine [&_[data-slot=slider-track]]:h-2"
              min={600}
              max={BUDGET_MAX}
              step={100}
              value={[budget ?? BUDGET_MAX]}
              onValueChange={([v]) => setDeck({ budget: v >= BUDGET_MAX ? null : v })}
              aria-label={t.budgetTitle}
            />
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[1000, 1800, 3000, null].map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setDeck({ budget: v })}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                    budget === v ? "border-pine bg-pine text-primary-foreground" : "border-line bg-card text-ink-soft",
                  )}
                >
                  {v == null ? t.flexible : fmtPLN(v)}
                </button>
              ))}
            </div>
            <div className="mt-auto flex gap-3 pt-10">
              <Button variant="outline" size="lg" className="h-12 rounded-2xl" onClick={() => setDeck({ step: "swipe", swipes: swipes.slice(0, -1) })}>
                <RotateCcw data-icon="inline-start" /> {t.undo}
              </Button>
              <Button size="lg" className="h-12 flex-1 rounded-2xl text-base" onClick={() => setDeck({ step: "airport" })}>
                {t.next} <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </motion.section>
        )}

        {step === "airport" && (
          <motion.section key="airport" {...slide} className="flex min-h-[70dvh] flex-col pt-6 pb-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-clay uppercase">3 / 3</p>
            <h1 className="mt-1 font-display text-[2rem] leading-tight text-ink">{t.airportTitle}</h1>
            <p className="mt-2 text-[15px] text-ink-soft">{t.airportSub}</p>
            <div className="mt-8 grid grid-cols-2 gap-2.5">
              {AIRPORTS.map(([code, city]) => {
                const on = airports.includes(code);
                return (
                  <motion.button
                    key={code}
                    whileTap={{ scale: 0.97 }}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setDeck({ airports: on ? airports.filter((a) => a !== code) : [...airports, code] })}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                      on ? "border-pine bg-pine text-primary-foreground shadow-soft" : "border-line bg-card text-ink",
                    )}
                  >
                    <Plane className={cn("size-4", on ? "text-paper" : "text-pine")} />
                    <span>
                      <span className="block font-mono text-sm font-semibold">{code}</span>
                      <span className={cn("block text-xs", on ? "text-paper/80" : "text-muted-foreground")}>{city}</span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
            <div className="mt-auto flex gap-3 pt-10">
              <Button variant="outline" size="lg" className="h-12 rounded-2xl" onClick={() => setDeck({ step: "budget" })}>
                {lang === "pl" ? "Wstecz" : "Back"}
              </Button>
              <Button
                size="lg"
                className="h-12 flex-1 rounded-2xl text-base"
                disabled={!airports.length || busy}
                onClick={async () => {
                  // Only move on once there is a result, so a reload never lands on an empty result screen.
                  if (await compute()) setDeck({ step: "result" });
                }}
              >
                {busy ? t.computing : t.showDna} {!busy && <ArrowRight data-icon="inline-end" />}
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
                budget={budget}
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
              <div className="mt-8 space-y-2">
                <Button size="lg" className="h-12 w-full rounded-2xl text-base" onClick={finish} disabled={busy}>
                  {t.continue} <ArrowRight data-icon="inline-end" />
                </Button>
                <Button asChild variant="outline" size="lg" className="h-12 w-full rounded-2xl text-base">
                  <Link href="/onboarding/chat">
                    <MessageCircle data-icon="inline-start" /> {t.chat}
                  </Link>
                </Button>
                <button onClick={restart} className="mx-auto flex items-center gap-1.5 py-2 text-sm text-muted-foreground hover:text-ink">
                  <Ban className="size-3.5" /> {t.restart}
                </button>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
