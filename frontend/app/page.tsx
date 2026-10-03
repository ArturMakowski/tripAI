"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, BadgeCheck, Hand, Receipt } from "lucide-react";
import { Logo, ModeBadge } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { useHydrated, useTrip } from "@/lib/store";

const PHOTOS = [
  { src: "/cities/lisbon.jpg", alt: "Alfama rooftops in Lisbon", className: "left-0 top-8 -rotate-6 w-[42%]" },
  { src: "/cities/rome.jpg", alt: "Colosseum in Rome", className: "left-[29%] top-0 z-10 w-[44%]" },
  { src: "/cities/athens.jpg", alt: "Acropolis in Athens", className: "right-0 top-10 rotate-6 w-[40%]" },
];

const PROMISES = [
  { icon: Receipt, text: "Every price and fact shows its source and when it was fetched." },
  { icon: BadgeCheck, text: "A transparent scoring formula ranks your options. The AI explains, it doesn't decide." },
  { icon: Hand, text: "Nothing gets booked until you say so." },
];

export default function Welcome() {
  const router = useRouter();
  const hydrated = useHydrated();
  const profile = useTrip((s) => s.profile);
  const setProfile = useTrip((s) => s.setProfile);
  const reset = useTrip((s) => s.reset);

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-5 pb-8 sm:min-h-0 sm:flex-1">
      <div className="flex items-center justify-between">
        <Logo />
        <ModeBadge />
      </div>

      <div className="relative mt-8 h-56">
        {PHOTOS.map((p, i) => (
          <motion.div
            key={p.src}
            className={`absolute aspect-[3/4] overflow-hidden rounded-2xl shadow-lift ring-4 ring-card ${p.className}`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.alt} className="size-full object-cover" />
          </motion.div>
        ))}
        <motion.div
          className="absolute -bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium whitespace-nowrap text-paper shadow-lift"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
        >
          e.g. &ldquo;You&rsquo;re free 14–19 Jan → Rome&rdquo;
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.6 }}>
        <h1 className="mt-12 font-display text-[2.4rem] leading-[1.04] font-medium text-ink">
          Tell us who you are and when you&rsquo;re free.
        </h1>
        <p className="mt-3 text-[17px] leading-relaxed text-ink-soft">
          We&rsquo;ll tell you <em className="font-display text-ink not-italic">where</em> and{" "}
          <em className="font-display text-ink not-italic">when</em> to go, and show how we got there.
        </p>
      </motion.div>

      <ul className="mt-7 space-y-3">
        {PROMISES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-3 text-sm leading-snug text-ink-soft">
            <Icon className="mt-0.5 size-4 shrink-0 text-pine" aria-hidden />
            {text}
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3 pt-8">
        {hydrated && profile ? (
          <>
            <Button size="lg" className="h-13 w-full rounded-2xl text-base" onClick={() => router.push("/trips")}>
              See your trips <ArrowRight data-icon="inline-end" />
            </Button>
            <button
              className="w-full py-2 text-sm text-muted-foreground hover:text-ink"
              onClick={() => {
                reset();
                router.push("/onboarding");
              }}
            >
              Start over
            </button>
          </>
        ) : (
          <>
            <Button asChild size="lg" className="h-13 w-full rounded-2xl text-base">
              <Link href="/onboarding">
                Swipe your Travel DNA <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Link href="/onboarding/chat" className="block w-full py-1 text-center text-sm text-ink-soft hover:text-ink">
              or chat with TripAI instead
            </Link>
            <button
              className="w-full py-2 text-sm text-muted-foreground hover:text-ink"
              onClick={() => {
                setProfile(DEMO_PROFILE);
                router.push("/profile");
              }}
            >
              Skip and use the demo profile
            </button>
          </>
        )}
      </div>
    </div>
  );
}
