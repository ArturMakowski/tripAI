"use client";

import { useEffect, type RefObject } from "react";
import { useTrip } from "@/lib/store";
import type { TutorialLang } from "./strings";

/**
 * Tutorial language until the app-wide setting (PR #22) lands. The intro is its own screen and follows the
 * Travel DNA toggle it hands off to; coach marks sit on screens that are still English, so they stay EN
 * (one language per screen, docs/DECLUTTER.md).
 */
export function useTutorialLang(scope: "intro" | "screen" = "intro"): TutorialLang {
  const deck = useTrip((s) => s.deck.lang);
  return scope === "intro" ? deck : "en";
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab inside `ref` while active, and gives focus back to the opener on close. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
