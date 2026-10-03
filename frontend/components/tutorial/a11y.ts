"use client";

import { useEffect, type RefObject } from "react";
import { trapStep } from "./geometry";

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
      // -1 when focus is on the dialog container itself (or escaped it): Tab/Shift+Tab then wrap inside.
      const to = trapStep(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (to === null) return;
      e.preventDefault();
      items[to].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
