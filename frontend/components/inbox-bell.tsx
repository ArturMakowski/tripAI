"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { NOTIFY_AVAILABLE, refreshUnread, registerServiceWorker, useInbox } from "@/lib/notify";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;

/** Header bell with the unread count. Registering the service worker here never prompts:
 * the permission prompt only appears when the user taps "Enable push" in /inbox/settings. */
export function InboxBell() {
  const unread = useInbox((s) => s.unread);
  const { t } = useT();

  useEffect(() => {
    if (!NOTIFY_AVAILABLE) return;
    registerServiceWorker();
    refreshUnread();
    const t = setInterval(refreshUnread, POLL_MS);
    const onFocus = () => refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <Link
      href="/inbox"
      className="relative grid size-8 place-items-center rounded-full text-ink-soft hover:bg-paper-deep"
      aria-label={t.inbox.bellAria(unread)}
    >
      <Bell className="size-[18px]" aria-hidden />
      {unread > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-clay px-1",
            "text-[10px] leading-none font-semibold text-paper tabular",
          )}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
