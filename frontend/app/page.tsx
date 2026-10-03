"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, BadgeCheck, Hand, Receipt } from "lucide-react";
import { LangSwitch } from "@/components/lang-switch";
import { Logo, ModeBadge, PhotoCreditsLink } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { useT } from "@/lib/i18n";
import { useHydrated, useTrip } from "@/lib/store";

// The photos are landscape (about 1.5:1) in 3:4 frames, so each keeps half its width: `focus` (object-position)
// picks the half with the landmark (Panteão dome, Colosseum's lit arcades, Parthenon).
const PHOTOS = [
  { src: "/cities/lisbon.jpg", key: "lisbon", focus: "20% 50%", className: "left-0 top-8 -rotate-6 w-[42%]" },
  { src: "/cities/rome.jpg", key: "rome", focus: "30% 50%", className: "left-[29%] top-0 z-10 w-[44%]" },
  { src: "/cities/athens.jpg", key: "athens", focus: "62% 50%", className: "right-0 top-10 rotate-6 w-[40%]" },
] as const;

const PROMISES = [
  { icon: Receipt, key: "sources" },
  { icon: BadgeCheck, key: "formula" },
  { icon: Hand, key: "noBooking" },
] as const;

export default function Welcome() {
  const router = useRouter();
  const hydrated = useHydrated();
  const profile = useTrip((s) => s.profile);
  const setProfile = useTrip((s) => s.setProfile);
  const reset = useTrip((s) => s.reset);
  const t = useT().t.home;

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-5 pb-8 sm:min-h-0 sm:flex-1">
      <div className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <LangSwitch />
          <ModeBadge />
        </div>
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
            <img src={p.src} alt={t.photos[p.key]} className="size-full object-cover" style={{ objectPosition: p.focus }} />
          </motion.div>
        ))}
        <motion.div
          className="absolute -bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium whitespace-nowrap text-paper shadow-lift"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
        >
          {t.example}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.6 }}>
        <h1 className="mt-12 font-display text-[2.4rem] leading-[1.04] font-medium text-ink">
          {t.title}
        </h1>
        <p className="mt-3 text-[17px] leading-relaxed text-ink-soft">
          {t.lead.before}
          <em className="font-display text-ink not-italic">{t.lead.where}</em>
          {t.lead.and}
          <em className="font-display text-ink not-italic">{t.lead.when}</em>
          {t.lead.after}
        </p>
      </motion.div>

      <ul className="mt-7 space-y-3">
        {PROMISES.map(({ icon: Icon, key }) => (
          <li key={key} className="flex gap-3 text-sm leading-snug text-ink-soft">
            <Icon className="mt-0.5 size-4 shrink-0 text-pine" aria-hidden />
            {t.promises[key]}
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3 pt-8">
        {hydrated && profile ? (
          <>
            <Button size="lg" className="h-13 w-full rounded-2xl text-base" onClick={() => router.push("/trips")}>
              {t.seeTrips} <ArrowRight data-icon="inline-end" />
            </Button>
            <button
              className="w-full py-2 text-sm text-muted-foreground hover:text-ink"
              onClick={() => {
                reset();
                router.push("/onboarding");
              }}
            >
              {t.startOver}
            </button>
          </>
        ) : (
          <>
            <Button asChild size="lg" className="h-13 w-full rounded-2xl text-base">
              <Link href="/onboarding">
                {t.swipe} <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Link href="/onboarding/chat" className="block w-full py-1 text-center text-sm text-ink-soft hover:text-ink">
              {t.chatInstead}
            </Link>
            <button
              className="w-full py-2 text-sm text-muted-foreground hover:text-ink"
              onClick={() => {
                setProfile(DEMO_PROFILE);
                router.push("/profile");
              }}
            >
              {t.demoProfile}
            </button>
          </>
        )}
        <PhotoCreditsLink className="pt-1" />
      </div>
    </div>
  );
}
