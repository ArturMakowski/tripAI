"use client";

/**
 * Declutter primitives (docs/DECLUTTER.md): trust details stay one tap away instead of on screen.
 *  - <Disclosure>  collapsed row "Evidence · 8 sources ›"; content stays in the DOM (hidden) so
 *                  links can target it, and it opens itself when something inside is revealed.
 *  - <InfoTip>     ⓘ that expands one explanatory line in place.
 *  - <Chip>        compact fact/source pill: "Open-Meteo · 3 paź", "Dane 69% na żywo".
 *  - reveal(el)    open every collapsed ancestor of an element, then scroll it into view.
 */
import { ChevronRight, Info } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const REVEAL_EVENT = "tripai:reveal";

/** Open collapsed ancestors of `el` (Disclosures listen), then call `then` once they're visible. */
export function reveal(el: HTMLElement, then: () => void) {
  const hidden: string[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) if (p.hidden && p.id) hidden.push(p.id);
  if (!hidden.length) return then();
  for (const id of hidden) window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
  requestAnimationFrame(() => requestAnimationFrame(then));
}

export function Disclosure({
  title,
  count,
  hint,
  children,
  defaultOpen = false,
  className,
  icon,
  tour,
}: {
  title: ReactNode;
  count?: number | string;
  /** one short line under the title while collapsed */
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  icon?: ReactNode;
  /** coach-mark anchor (components/tutorial) */
  tour?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId().replace(/:/g, "");
  const panel = `disclosure-${id}`;
  useEffect(() => {
    const onReveal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === panel) setOpen(true);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [panel]);
  return (
    <div data-tour={tour} className={cn("rounded-2xl border border-line bg-card shadow-soft", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panel}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {icon && <span className="shrink-0 text-pine">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium text-ink">
            {title}
            {count != null && <span className="text-muted-foreground"> · {count}</span>}
          </span>
          {hint && !open && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      <div id={panel} hidden={!open} className="border-t border-line px-4 pt-3 pb-4">
        {children}
      </div>
    </div>
  );
}

export function InfoTip({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const id = useId().replace(/:/g, "");
  return (
    <span className={cn("inline", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`tip-${id}`}
        aria-label={label ?? t.common.moreInfo}
        className="inline-grid size-6 translate-y-[3px] place-items-center rounded-full text-muted-foreground hover:bg-paper-deep hover:text-ink"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span id={`tip-${id}`} hidden={!open} className="mt-1 block text-xs leading-snug text-muted-foreground">
        {children}
      </span>
    </span>
  );
}

export function Chip({ children, icon, className, title }: { children: ReactNode; icon?: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-paper-deep px-2 py-0.5 text-xs text-ink-soft", className)}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
