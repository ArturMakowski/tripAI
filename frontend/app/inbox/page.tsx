"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BellOff, BellRing, CalendarHeart, Crown, Eye, Fingerprint, Loader2, Radar, Settings2, TrendingDown, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell, PageTitle } from "@/components/shell";
import { SourceTag } from "@/components/source-tag";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { NOTIFY_AVAILABLE, notifyApi, openNotification, refreshUnread } from "@/lib/notify";
import type { AppNotification, NotificationKind, ScanResult } from "@/lib/notify-types";
import { useTrip } from "@/lib/store";
import { fitMeta } from "@/lib/fit";
import { cn } from "@/lib/utils";

const KIND: Record<NotificationKind, { icon: typeof Crown; tone: string }> = {
  new_top: { icon: Crown, tone: "bg-pine-soft text-pine-deep" },
  price_drop: { icon: TrendingDown, tone: "bg-clay-soft text-clay" },
  long_weekend: { icon: CalendarHeart, tone: "bg-sun-soft text-ink" },
};

function NotificationCard({ n, onOpen, busy }: { n: AppNotification; onOpen: (n: AppNotification) => void; busy: boolean }) {
  const k = KIND[n.kind];
  const { t, fmt, lang } = useT();
  const ib = t.inbox;
  const flight = n.evidence.find((e) => e.kind === "flight");
  const [watch, setWatch] = useState<"idle" | "busy" | "done" | "error">("idle");
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-2xl border bg-card p-4", n.read_at ? "border-line" : "border-pine/40 shadow-lift", busy && "opacity-60")}
    >
      <button onClick={() => onOpen(n)} className="block w-full text-left">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", k.tone)}>
            <k.icon className="size-3.5" aria-hidden /> {ib.kinds[n.kind]}
          </span>
          {n.fit_label && (
            <span className="rounded-full border border-line px-2 py-0.5 text-ink-soft">{fitMeta(n.fit_label, lang).label}</span>
          )}
          <span className="ml-auto text-muted-foreground">{fmt.timestamp(n.created_at)}</span>
          {!n.read_at && <span className="size-2 rounded-full bg-clay" aria-label={ib.unread} />}
        </div>
        <p className="mt-2 text-[15px] leading-snug font-semibold text-ink">{n.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{n.body}</p>
        {n.fit_summary && <p className="mt-2 text-sm text-ink">{n.fit_summary}</p>}
        {n.concerns.length > 0 && (
          <ul className="mt-2 space-y-1">
            {n.concerns.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[13px] text-clay">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {c.text}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{n.why}</p>
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
        {flight && <SourceTag e={flight} />}
        {n.interrupt_p != null && (
          <span
            className={cn("inline-flex items-center gap-1 text-[11px]", n.interrupt_ok ? "text-pine" : "text-muted-foreground")}
            title={ib.gateTitle(n.interrupt_source ?? "?")}
          >
            {n.interrupt_ok ? <BellRing className="size-3" aria-hidden /> : <BellOff className="size-3" aria-hidden />}
            {n.interrupt_ok ? ib.pushWorthy : ib.inboxOnly} · p {fmt.num(n.interrupt_p, 2)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground" title={`inputs_hash ${n.inputs_hash}`}>
          <Fingerprint className="size-3" aria-hidden /> {n.inputs_hash.slice(0, 10)}
        </span>
        {n.kind !== "price_drop" && (
          <button
            disabled={watch === "busy" || watch === "done"}
            onClick={() => {
              setWatch("busy");
              notifyApi.watch(n.recommendation_id).then(() => setWatch("done"), () => setWatch("error"));
            }}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-pine hover:underline disabled:opacity-60"
          >
            <Eye className="size-3.5" aria-hidden />
            {watch === "done" ? ib.watching : watch === "error" ? ib.watchFailed : ib.watchPrice}
          </button>
        )}
      </div>
    </motion.li>
  );
}

function ScanSummary({ res }: { res: ScanResult }) {
  const r = res.run;
  const fresh = res.notifications.length;
  const { t } = useT();
  const ib = t.inbox;
  return (
    <div className="mt-3 rounded-xl bg-paper-deep p-3 text-[13px] text-ink-soft">
      <p>
        {r.mode === "dbos" ? ib.scanDurable : ib.scan}: {ib.scanSummary(r.windows, r.candidates)}
        {r.top_city ? ib.scanTop(r.top_city) : ""}. {ib.scanFresh(fresh)}
        {!r.personalized && ib.scanNeutral}
      </p>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-xs font-medium text-pine">{ib.whyPinged}</summary>
        <ul className="mt-1.5 space-y-1 text-xs">
          {r.decisions.map((d, i) => (
            <li key={i} className="flex gap-1.5">
              <span className={d.notify ? "text-pine" : "text-muted-foreground"}>{d.notify ? "✓" : "–"}</span>
              <span>
                <b className="font-medium text-ink">{ib.kinds[d.kind]}</b>
                {d.recommendation_id ? ` ${d.recommendation_id}` : ""}: {d.reason}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export default function InboxPage() {
  const router = useRouter();
  const profile = useTrip((s) => s.profile);
  const weights = useTrip((s) => s.weights);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const { t } = useT();
  const ib = t.inbox;

  const load = useCallback(async () => {
    try {
      const inbox = await notifyApi.inbox();
      setItems(inbox.items);
      setError(null);
      refreshUnread();
    } catch (e) {
      setError(errorText(e, t));
      setItems([]);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    if (NOTIFY_AVAILABLE) load();
  }, [load]);

  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      setScan(await notifyApi.runScan(profile, weights));
      await load();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setScanning(false);
    }
  }

  async function open(n: AppNotification) {
    setOpening(n.id);
    try {
      router.push(await openNotification(n));
    } finally {
      setOpening(null);
    }
  }

  return (
    <AppShell
      action={
        <Link href="/inbox/settings" className="grid size-8 place-items-center rounded-full text-ink-soft hover:bg-paper-deep" aria-label={ib.settingsAria}>
          <Settings2 className="size-[18px]" aria-hidden />
        </Link>
      }
    >
      <PageTitle eyebrow={ib.eyebrow} title={ib.heading}>
        {ib.intro}
      </PageTitle>

      {!NOTIFY_AVAILABLE ? (
        <p className="rounded-xl bg-paper-deep p-4 text-sm text-ink-soft">
          {ib.needsBackendA}
          <code>NEXT_PUBLIC_API_URL</code>
          {ib.needsBackendB}
        </p>
      ) : (
        <>
          <div data-tour="scan" className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-pine text-paper">
                <Radar className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{ib.runNow}</p>
                <p className="text-xs text-muted-foreground">{ib.runNowSub}</p>
              </div>
              <Button onClick={runScan} disabled={scanning} className="h-10 rounded-xl px-4">
                {scanning ? <Loader2 className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
                {scanning ? ib.scanning : ib.scanButton}
              </Button>
            </div>
            {scan && <ScanSummary res={scan} />}
          </div>

          {error && <p className="mt-4 rounded-xl bg-clay-soft p-3 text-sm text-clay">{error}</p>}

          <ul className="mt-5 space-y-3">
            <AnimatePresence initial={false}>
              {items?.map((n) => (
                <NotificationCard key={n.id} n={n} onOpen={open} busy={opening === n.id} />
              ))}
            </AnimatePresence>
          </ul>
          {items === null && <p className="mt-6 text-center text-sm text-muted-foreground">{ib.loading}</p>}
          {items?.length === 0 && !error && (
            <p className="mt-6 text-center text-sm text-muted-foreground">{ib.empty}</p>
          )}
        </>
      )}
    </AppShell>
  );
}
