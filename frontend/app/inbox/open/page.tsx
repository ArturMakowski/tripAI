"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/shell";
import { useT } from "@/lib/i18n";
import { notifyApi, openNotification } from "@/lib/notify";

/** Landing for a tapped push (public/sw.js): load the notification's card into the app, then
 * continue to /trips/[id] so the receipt shows exactly what the notification promised. */
function Open() {
  const router = useRouter();
  const id = useSearchParams().get("n");
  const [failed, setFailed] = useState(false);
  const { t } = useT();

  useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const inbox = await notifyApi.inbox();
      const n = inbox.items.find((x) => x.id === id);
      if (!n) throw new Error("not found");
      const url = await openNotification(n);
      if (live) router.replace(url);
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, router]);

  return (
    <AppShell back="/inbox" title={t.inbox.title}>
      <div className="grid place-items-center pt-24 text-sm text-ink-soft">
        {failed || !id ? (
          <Link href="/inbox" className="text-pine underline-offset-2 hover:underline">
            {t.inbox.open.gone}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t.inbox.open.opening}
          </span>
        )}
      </div>
    </AppShell>
  );
}

export default function OpenNotificationPage() {
  return (
    <Suspense>
      <Open />
    </Suspense>
  );
}
