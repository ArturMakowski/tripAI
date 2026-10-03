"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUp, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/shell";
import { ProfileChips } from "@/components/profile-chips";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { INTERVIEW_OPENER, suggestionsFor } from "@/lib/mock/api";
import { useHydrated, useTrip } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

const TOTAL_QUESTIONS = 4;

function Bubble({ m }: { m: ChatMessage }) {
  const me = m.role === "user";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className={cn("flex", me ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] px-4 py-2.5 text-[15px] leading-relaxed",
          me
            ? "rounded-[1.25rem] rounded-br-md bg-pine text-primary-foreground"
            : "rounded-[1.25rem] rounded-bl-md border border-line bg-card text-ink shadow-soft",
        )}
      >
        {m.content}
      </div>
    </motion.div>
  );
}

function Typing() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex">
      <div className="flex gap-1 rounded-[1.25rem] rounded-bl-md border border-line bg-card px-4 py-3.5 shadow-soft">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </motion.div>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { messages, setMessages, profile, setProfile, setMode } = useTrip();
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Seed the conversation with the opener (static so the first paint is instant).
  useEffect(() => {
    if (hydrated && messages.length === 0) {
      setMessages([{ role: "assistant", content: INTERVIEW_OPENER }]);
    }
  }, [hydrated, messages.length, setMessages]);

  const answered = messages.filter((m) => m.role === "user").length;
  const lastQuestion = messages.findLast((m) => m.role === "assistant")?.content ?? "";
  const suggestions = busy ? [] : suggestionsFor(lastQuestion, answered);
  const [gotProfile, setGotProfile] = useState(false);
  const result = gotProfile || answered >= TOTAL_QUESTIONS ? profile : null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy, result]);


  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setPicked([]);
    setBusy(true);
    const { data, mode } = await api.interview(next);
    setMode("interview", mode);
    setBusy(false);
    setMessages([...next, { role: "assistant", content: data.reply }]);
    if (data.profile) {
      setProfile(data.profile);
      setGotProfile(true);
    }
  }

  const composed = [...picked, draft.trim()].filter(Boolean).join(", ");

  return (
    <AppShell back="/" title="Interview" nav={false}>
      <div className="sticky top-14 z-20 -mx-5 bg-paper/85 px-5 pb-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {Array.from({ length: TOTAL_QUESTIONS }, (_, i) => (
            <motion.div
              key={i}
              className="h-1 flex-1 rounded-full bg-line"
              animate={{ backgroundColor: i < answered ? "var(--pine)" : "var(--line)" }}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {result
            ? "Done. Your answers only shape your taste profile."
            : answered >= TOTAL_QUESTIONS
              ? "Almost done. Just a follow-up or two."
              : `Question ${answered + 1} of ${TOTAL_QUESTIONS}`}
        </p>
      </div>

      <div className="space-y-3 pt-2 pb-40">
        {messages.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        <AnimatePresence>{busy && <Typing />}</AnimatePresence>

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-3xl border border-line bg-card p-4 shadow-soft"
          >
            <p className="mb-3 text-xs font-semibold tracking-[0.14em] text-clay uppercase">Your taste profile</p>
            <ProfileChips profile={result} compact />
            <Button className="mt-4 h-11 w-full rounded-xl" onClick={() => router.push("/profile")}>
              Review &amp; edit <ArrowRight data-icon="inline-end" />
            </Button>
          </motion.div>
        )}
        <div ref={endRef} />
      </div>

      {!result && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[440px] border-t border-line bg-paper/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-md sm:bottom-6 sm:rounded-b-[2.25rem]">
          <AnimatePresence>
            {suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4"
              >
                {suggestions.map((s) => {
                  const on = picked.includes(s);
                  return (
                    <button
                      key={s}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                        on ? "border-pine bg-pine-soft text-pine-deep" : "border-line bg-card text-ink-soft hover:border-pine/40",
                      )}
                    >
                      {on && <Check className="size-3.5" aria-hidden />}
                      {s}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(composed);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={picked.length ? "Add anything else…" : "Type, or tap the options above"}
              className="h-12 flex-1 rounded-full border border-line bg-card px-4 text-[15px] text-ink outline-none placeholder:text-muted-foreground focus:border-pine/50 focus:ring-3 focus:ring-pine/15"
              aria-label="Your answer"
            />
            <Button type="submit" size="icon" className="size-12 rounded-full" disabled={!composed || busy} aria-label="Send">
              <ArrowUp className="size-5" />
            </Button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
