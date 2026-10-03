"use client";

import { Dialog } from "radix-ui";
import { Info, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The one ⓘ on a screen, opening a bottom sheet (docs/DECLUTTER.md: secondary detail one tap away,
 * never pushing the page down). Built on the Radix dialog already in the app.
 */
export function WhySheet({ label, title, close, children }: { label: string; title: string; close: string; children: ReactNode }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label={label}
        className="inline-grid size-6 translate-y-[3px] place-items-center rounded-full text-muted-foreground hover:bg-paper-deep hover:text-ink"
      >
        <Info className="size-3.5" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[75vh] w-full max-w-md overflow-y-auto rounded-t-[1.75rem] bg-paper px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-soft"
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" aria-hidden />
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-xl text-ink">{title}</Dialog.Title>
            <Dialog.Close aria-label={close} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-paper-deep hover:text-ink">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="mt-3 text-sm leading-snug text-ink-soft">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
