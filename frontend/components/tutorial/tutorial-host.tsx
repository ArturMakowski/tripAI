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

  useEffect(() => hydrate(), [hydrate]);

  useEffect(() => {
    if (hydrated && shouldAutoOpenIntro(flags, path)) openIntro();
  }, [hydrated, flags, path, openIntro]);

  if (!mounted || !hydrated) return null;
  const tour = tourForPath(path);
  const showTour = !introOpen && flags.intro && tour && !flags.tours[tour];

  return (
    <>
      <AnimatePresence>{introOpen && <TutorialIntro key="intro" />}</AnimatePresence>
      {showTour && <CoachMarks key={`${tour}:${path}`} tour={tour} />}
    </>
  );
}
