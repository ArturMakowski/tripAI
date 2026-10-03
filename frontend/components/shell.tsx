"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, Compass, MessageSquareHeart, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { FORCE_MOCK } from "@/lib/api";
import { useTrip } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2", className)} aria-label="TripAI home">
      <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
        <circle cx="14" cy="14" r="13" fill="var(--pine)" />
        <path d="M7 17.5c3.5-1 6-3.6 7.2-8.5 1 3.9 3.2 6.8 6.8 8.4" fill="none" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="14" cy="20.5" r="1.6" fill="var(--clay)" />
      </svg>
      <span className="font-display text-[1.35rem] font-semibold tracking-tight text-ink">TripAI</span>
    </Link>
  );
}

export function ModeBadge() {
  const mode = useTrip((s) => s.mode) ?? (FORCE_MOCK ? "fixture" : null);
  if (!mode) return null;
  const live = mode === "live";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink-soft"
      title={live ? "Answers come from the TripAI backend" : "Backend not configured or unreachable: recorded fixtures"}
    >
      <span className={cn("size-1.5 rounded-full", live ? "bg-pine animate-pulse" : "bg-sun")} />
      {live ? "Live API" : "Demo fixtures"}
    </span>
  );
}

const NAV = [
  { href: "/trips", label: "Trips", icon: Compass },
  { href: "/windows", label: "Free time", icon: CalendarDays },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/survey", label: "Feedback", icon: MessageSquareHeart },
];

function BottomNav() {
  const path = usePathname();
  return (
    <nav className="sticky bottom-0 z-30 border-t border-line bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <ul className="grid grid-cols-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href !== "/" && path.startsWith(`${href}/`));
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-pine" : "text-muted-foreground hover:text-ink",
                )}
              >
                <Icon className={cn("size-5", active && "stroke-[2.2]")} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({
  children,
  back,
  title,
  nav = true,
  action,
}: {
  children: ReactNode;
  back?: string | true;
  title?: string;
  nav?: boolean;
  action?: ReactNode;
}) {
  const router = useRouter();
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-transparent bg-paper/85 px-5 backdrop-blur-md">
        {back ? (
          <button
            onClick={() => (back === true ? router.back() : router.push(back))}
            className="-ml-2 flex items-center gap-1 rounded-full py-1 pr-3 pl-1 text-sm font-medium text-ink-soft hover:bg-paper-deep"
          >
            <ChevronLeft className="size-5" aria-hidden />
            {title ?? "Back"}
          </button>
        ) : (
          <Logo />
        )}
        <div className="flex items-center gap-2">
          {action}
          <ModeBadge />
        </div>
      </header>
      <main className="flex-1 px-5 pb-10">{children}</main>
      {nav && <BottomNav />}
    </>
  );
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pt-3 pb-5">
      {eyebrow && <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-clay uppercase">{eyebrow}</p>}
      <h1 className="font-display text-[2rem] leading-[1.08] font-medium text-ink">{title}</h1>
      {children && <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">{children}</p>}
    </div>
  );
}
