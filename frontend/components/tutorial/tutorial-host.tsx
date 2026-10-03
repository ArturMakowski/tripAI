"use client";

import { AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { shouldAutoOpenIntro, tourForPath, useMounted, useTutorial } from "@/lib/tutorial-store";
import { CoachMarks } from "./coach-marks";
import { TutorialIntro } from "./intro";

/**
 * Mounted once in the root layout. Opens the intro on a first visit, and once it has been seen,
 * shows the current screen's coach marks the first time that screen is opened.
 */
export function TutorialHost() {
  const mounted = useMounted();
  const path = usePathname();
  const hydrated = useTutorial((s) => s.hydrated);
  const flags = useTutorial((s) => s.flags);
  const introOpen = useTutorial((s) => s.introOpen);
  const hydrate = useTutorial((s) => s.hydrate);
  const openIntro = useTutorial((s) => s.openIntro);
  // The tour running on this screen is marked seen when it starts (once each, even if the user
  // navigates away mid-tour), so which one runs is tracked in the store, not read back from the flags.
  const running = useTutorial((s) => s.runningTour);
  const startTour = useTutorial((s) => s.startTour);

  useEffect(() => hydrate(), [hydrate]);

  useEffect(() => {
    if (hydrated && shouldAutoOpenIntro(flags, path)) openIntro();
  }, [hydrated, flags, path, openIntro]);

  const tour = tourForPath(path);
  const key = tour ? `${tour}:${path}` : null;
  useEffect(() => {
    // Tours don't wait for the intro (review #41): someone who leaves the welcome screen by "Profil
    // demo" never sees the intro, but still gets each screen's tips once.
    if (!hydrated || introOpen || !tour || !key || flags.tours[tour]) return;
    startTour(tour, key);
  }, [hydrated, introOpen, flags, tour, key, startTour]);

  if (!mounted || !hydrated) return null;
  const showTour = !introOpen && !!tour && running === key;

  return (
    <>
      <AnimatePresence>{introOpen && <TutorialIntro key="intro" />}</AnimatePresence>
      {showTour && tour && <CoachMarks key={key} tour={tour} />}
    </>
  );
}
