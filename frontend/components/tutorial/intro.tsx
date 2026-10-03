"use client";

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTrip } from "@/lib/store";
import { stepTo, useTutorial } from "@/lib/tutorial-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useFocusTrap } from "./a11y";
import { IntroArt } from "./intro-art";
import { INTRO_STEPS } from "./strings";

const SWIPE_PX = 60;

/**
 * First-run intro: four full-screen steps. Swipe, Next/Back, the dots, or ←/→ move between them;
 * Esc or "Skip" closes it (always visible). The last step hands off to the Travel DNA deck, or
 * just closes for someone who already has a profile.
 */
export function TutorialIntro() {
  const close = useTutorial((s) => s.closeIntro);
  const hasProfile = useTrip((s) => !!s.profile);
  const t = useT().t.tutorial;
  const router = useRouter();
  const path = usePathname();
  const reduced = !!useReducedMotion();
  const [[step, dir], setStep] = useState<[number, number]>([0, 1]);
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const n = INTRO_STEPS.length;
  const last = step === n - 1;
  const id = INTRO_STEPS[step];

  useFocusTrap(ref, true);

  const go = (target: number) => {
    const next = stepTo(target, n);
    if (next !== step) setStep([next, next > step ? 1 : -1]);
  };

  const finish = () => {
    close();
    if (!hasProfile && path !== "/onboarding") router.push("/onboarding");
  };

  // Each step's heading takes focus so screen readers read the new title and body.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Lock page scroll behind the dialog.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      go(step + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(step - 1);
    }
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_PX || info.velocity.x < -400) go(step + 1);
    else if (info.offset.x > SWIPE_PX || info.velocity.x > 400) go(step - 1);
  };

  const slide = reduced ? 0 : 56;

  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-ink/30 backdrop-blur-sm sm:py-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.25 }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t.dialogLabel}
        onKeyDown={onKeyDown}
        className="mx-auto flex h-full w-full max-w-[440px] flex-col overflow-hidden bg-paper pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:rounded-[2.25rem] sm:shadow-lift"
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-5">
          <p className="text-xs font-semibold tracking-[0.14em] text-clay uppercase" aria-live="polite">
            {t.stepOf(step + 1, n)}
          </p>
          <button
            type="button"
            onClick={close}
            className="-mr-2 min-h-11 rounded-full px-3 text-sm font-medium text-ink-soft hover:bg-paper-deep hover:text-ink"
          >
            {t.skip}
          </button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.div
              key={id}
              custom={dir}
              className="absolute inset-0 flex cursor-grab touch-pan-y flex-col px-6 active:cursor-grabbing"
              initial={{ opacity: 0, x: dir * slide }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -dir * slide }}
              transition={{ duration: reduced ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
              drag={reduced ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.25}
              onDragEnd={onDragEnd}
            >
              <div className="flex flex-1 items-center justify-center pt-2">
                <IntroArt step={id} art={t.art} reduced={reduced} />
              </div>
              <div className="pb-4">
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[1.9rem] leading-[1.08] font-medium text-ink outline-none">
                  {t.steps[id].title}
                </h2>
                <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">{t.steps[id].body}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="shrink-0 px-6 pt-2">
          <div className="mb-3 flex justify-center">
            {INTRO_STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => go(i)}
                aria-label={t.goToStep(i + 1)}
                aria-current={i === step ? "step" : undefined}
                className="grid size-10 place-items-center rounded-full"
              >
                <span className={cn("h-2 rounded-full transition-all duration-300", i === step ? "w-6 bg-pine" : "w-2 bg-line")} />
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            {step > 0 && (
              <Button variant="outline" size="lg" className="h-13 rounded-2xl px-4 text-base" onClick={() => go(step - 1)}>
                <ArrowLeft aria-hidden /> <span className="sr-only sm:not-sr-only">{t.back}</span>
              </Button>
            )}
            <Button size="lg" className="h-13 flex-1 rounded-2xl text-base" onClick={() => (last ? finish() : go(step + 1))}>
              {last ? (hasProfile || path === "/onboarding" ? t.ctaDone : t.ctaDeck) : t.next}
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
