"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, Compass, MessageSquareHeart, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { InboxBell } from "@/components/inbox-bell";
import { LangSwitch } from "@/components/lang-switch";
import { useT } from "@/lib/i18n";
import { FORCE_MOCK } from "@/lib/api";
import { overallMode, useTrip } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <Link href="/" className={cn("flex items-center gap-2", className)} aria-label={t.common.home}>
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
  const { t } = useT();
  const modes = useTrip((s) => s.modes);
  const mode = overallMode(modes) ?? (FORCE_MOCK ? "fixture" : null);
  if (!mode) return null;
  const live = mode === "live";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-soft"
      title={live ? t.common.mode.liveTitle : t.common.mode.fixtureTitle}
    >
      <span className={cn("size-1.5 rounded-full", live ? "bg-pine animate-pulse" : "bg-sun")} />
      {live ? t.common.mode.live : t.common.mode.fixture}
    </span>
  );
}

const NAV: { href: string; key: "trips" | "windows" | "profile" | "feedback"; icon: typeof Compass }[] = [
  { href: "/trips", key: "trips", icon: Compass },
  { href: "/windows", key: "windows", icon: CalendarDays },
  { href: "/profile", key: "profile", icon: UserRound },
  { href: "/survey", key: "feedback", icon: MessageSquareHeart },
];

function BottomNav() {
  const { t } = useT();
  const path = usePathname();
  return (
    <nav className="sticky bottom-0 z-30 border-t border-line bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <ul className="grid grid-cols-4">
        {NAV.map(({ href, key, icon: Icon }) => {
          const label = t.common.nav[key];
          const active = path === href || (href !== "/" && path.startsWith(`${href}/`));
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
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
  const { t } = useT();
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
            {title ?? t.common.back}
          </button>
        ) : (
          <Logo />
        )}
        <div className="flex items-center gap-2">
          {action}
          <LangSwitch />
          <InboxBell />
          <ModeBadge />
        </div>
      </header>
      <main className="flex-1 px-5 pb-10">
        {children}
        <PhotoCreditsLink className="mt-10" />
      </main>
      {nav && <BottomNav />}
    </>
  );
}

/** Footer link to /credits: CC BY / BY-SA photos need visible attribution wherever they are shown. */
export function PhotoCreditsLink({ className }: { className?: string }) {
  const path = usePathname();
  if (path === "/credits") return null;
  return (
    <p className={cn("text-center text-xs", className)}>
      <Link href="/credits" className="text-muted-foreground underline decoration-line underline-offset-2 hover:text-ink">
        Photo credits
      </Link>
    </p>
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
