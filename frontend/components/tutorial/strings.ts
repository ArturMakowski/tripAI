/** Tutorial structure. Copy lives in the i18n namespace `tutorial` (lib/i18n/messages/tutorial.ts). */
import type { TourKey } from "@/lib/tutorial-store";

export type IntroStepId = "dna" | "calendar" | "proof" | "decide";
export const INTRO_STEPS: IntroStepId[] = ["dna", "calendar", "proof", "decide"];

/** Coach-mark anchor ids; every one is an element carrying `data-tour="<id>"` (the first visible one wins). */
export type AnchorId = "slider" | "fit" | "swipe-row" | "source" | "flip" | "calendar" | "scan";

export const TOURS: Record<TourKey, { anchor: AnchorId }[]> = {
  trips: [{ anchor: "slider" }, { anchor: "fit" }, { anchor: "swipe-row" }],
  receipt: [{ anchor: "source" }, { anchor: "flip" }],
  windows: [{ anchor: "calendar" }],
  inbox: [{ anchor: "scan" }],
};
