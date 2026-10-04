"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, BadgeCheck, Hand, Receipt } from "lucide-react";
import { LangSwitch } from "@/components/lang-switch";
import { Logo } from "@/components/shell";
import { Chip } from "@/components/declutter";
import { HomeToday, MyTripsLink } from "@/components/home-today";
import { InboxBell } from "@/components/inbox-bell";
import { Button } from "@/components/ui/button";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useHydrated, useTrip } from "@/lib/store";

// The photos are landscape (about 1.5:1) in 3:4 frames, so each keeps half its width: `focus` (object-position)
// picks the half with the landmark (Panteão dome, Colosseum's lit arcades, Parthenon).
const PHOTOS = [
  { src: "/cities/lisbon.jpg", key: "lisbon", focus: "20% 50%", className: "left-[9%] top-6 -rotate-6 w-[29%]" },
  { src: "/cities/rome.jpg", key: "rome", focus: "30% 50%", className: "left-[34.5%] top-0 z-10 w-[31%]" },
  { src: "/cities/athens.jpg", key: "athens", focus: "62% 50%", className: "right-[9%] top-7 rotate-6 w-[28%]" },
] as const;

const PROMISES = [
  { icon: Receipt, key: "sources" },
  { icon: BadgeCheck, key: "formula" },
  { icon: Hand, key: "noBooking" },
] as const;

/**
 * The welcome screen: the very first thing a new user sees (user testing round 3): what TripAI does
 * in one line, three icon chips, one CTA "Zaczynamy", straight into the Travel DNA deck (T19: no intro
 * in between; coach marks explain each screen once).
 */
export default function Welcome() {
  const router = useRouter();
  const hydrated = useHydrated();
  const profile = useTrip((s) => s.profile);
  const setProfile = useTrip((s) => s.setProfile);
  const reset = useTrip((s) => s.reset);
  const t = useT().t.home;
  // the returning view makes room for the "today" summary: smaller collage, no promise chips, sticky CTA
  const returning = hydrated && !!profile;

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-5 pb-8 sm:min-h-0 sm:flex-1">
      <div className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          {/* returning: planned trips + unread notifications as header icons, not more words on the page */}
          {returning && (
            <>
              <MyTripsLink />
              <InboxBell />
            </>
          )}
          <LangSwitch />
        </div>
      </div>

      <div className={cn("relative", returning ? "mx-auto mt-2 h-28 w-[72%]" : "mt-5 h-40 w-full")}>
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
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.6 }}>
        <h1 className={cn(returning ? "mt-6" : "mt-9", "font-display text-[2.4rem] leading-[1.04] font-medium text-ink")}>
          {t.title}
        </h1>
        <p className="mt-2.5 text-[17px] leading-snug text-ink-soft">
          {t.lead.before}
          <em className="font-display text-ink not-italic">{t.lead.where}</em>
          {t.lead.and}
          <em className="font-display text-ink not-italic">{t.lead.when}</em>
          {t.lead.after}
        </p>
      </motion.div>

      {/* the trust promises are for newcomers; a returning user sees their #1 and next time off instead (≤ 25 words) */}
      {!returning && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {PROMISES.map(({ icon: Icon, key }) => (
            <li key={key}>
              <Chip icon={<Icon className="size-3.5 text-pine" aria-hidden />} className="px-2.5 py-1 text-[13px]">
                {t.promises[key]}
              </Chip>
            </li>
          ))}
        </ul>
      )}

      {/* returning user: their #1 trip and the next time off (the first-run welcome stays as it is) */}
      {returning && <HomeToday />}

      <div
        className={cn(
          "mt-auto space-y-3",
          returning ? "sticky bottom-0 -mx-6 -mb-8 bg-gradient-to-t from-background from-80% to-background/0 px-6 pt-5 pb-4" : "pt-6",
        )}
      >
        {returning ? (
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
            {/* Secondary ways in, on one line under the single primary action. */}
            <p className="flex items-center justify-center gap-3 text-sm text-ink-soft">
              <Link href="/onboarding/chat" className="py-1 hover:text-ink">
                {t.chatInstead}
              </Link>
              <span aria-hidden className="text-line">·</span>
              <button
                className="py-1 text-muted-foreground hover:text-ink"
                onClick={() => {
                  setProfile(DEMO_PROFILE);
                  router.push("/profile");
                }}
              >
                {t.demoProfile}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
