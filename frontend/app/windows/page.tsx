"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, CalendarCheck2, Radar, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { AppShell, PageTitle } from "@/components/shell";
import { api } from "@/lib/api";
import { dayCount, eachDay, formatRange, weekday } from "@/lib/format";
import { useHydrated, useTrip } from "@/lib/store";
import type { FreeWindow } from "@/lib/types";
import { cn } from "@/lib/utils";

type DayKind = "weekend" | "holiday" | "off" | "free";

function dayKind(iso: string, w: FreeWindow): DayKind {
  if (w.bridge?.take_off.includes(iso)) return "off";
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return "weekend";
  return w.bridge ? "holiday" : "free";
}

const KIND_STYLE: Record<DayKind, string> = {
  weekend: "bg-pine-soft text-pine-deep",
  holiday: "bg-clay text-white",
  off: "border-2 border-dashed border-sun bg-sun-soft text-ink",
  free: "bg-sky-soft text-ink",
};

function DayStrip({ w }: { w: FreeWindow }) {
  return (
    <div className="flex gap-1.5">
      {eachDay(w).map((iso, i) => {
        const k = dayKind(iso, w);
        return (
          <motion.div
            key={iso}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
            className={cn("flex w-10 flex-col items-center rounded-xl py-1.5", KIND_STYLE[k])}
            title={k === "off" ? "Take this day off" : k}
          >
            <span className="text-[10px] font-medium uppercase opacity-75">{weekday(iso).slice(0, 2)}</span>
            <span className="tabular text-sm font-semibold">{Number(iso.slice(8))}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function Legend() {
  const items: [DayKind, string][] = [
    ["holiday", "Public holiday"],
    ["weekend", "Weekend"],
    ["off", "Day off to take"],
    ["free", "Free in calendar"],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[4px]", KIND_STYLE[k])} />
          {label}
        </span>
      ))}
    </div>
  );
}

export default function WindowsPage() {
  const hydrated = useHydrated();
  const { windows, setWindows, setMode } = useTrip();

  useEffect(() => {
    if (!hydrated || windows.length) return;
    api.windows("2027-01-01", "2027-06-30").then(({ data, mode }) => {
      setWindows(data);
      setMode(mode);
    });
  }, [hydrated, windows.length, setWindows, setMode]);

  const bridges = windows
    .filter((w) => w.bridge && w.bridge.days_off > 0)
    .sort((a, b) => b.bridge!.total_days / b.bridge!.days_off - a.bridge!.total_days / a.bridge!.days_off);
  const calendar = windows.filter((w) => !w.bridge || w.bridge.days_off === 0);

  return (
    <AppShell>
      <PageTitle eyebrow="Free time" title="When you could go.">
        From your Google Calendar plus Polish public holidays. You never have to type a date.
      </PageTitle>

      <section className="rounded-3xl bg-ink p-5 text-paper shadow-lift">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-xl">
            <Radar className="size-5 text-sun" aria-hidden /> Długi weekend radar
          </h2>
          <span className="text-[11px] text-paper/60">PL holidays · Nager.Date</span>
        </div>
        <p className="mt-1 text-sm text-paper/70">Take a day or two off around a holiday and you get a much longer trip.</p>

        <ul className="mt-4 space-y-3">
          {bridges.map((w, i) => (
            <motion.li
              key={w.start}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * i }}
              className="rounded-2xl bg-paper p-4 text-ink"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[1.35rem] leading-tight">
                    Take <span className="text-clay">{w.bridge!.days_off} day{w.bridge!.days_off > 1 ? "s" : ""} off</span> →{" "}
                    {w.bridge!.total_days} days
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {w.bridge!.holiday} · {formatRange(w)}
                  </p>
                </div>
                {i === 0 && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-sun-soft px-2 py-0.5 text-[11px] font-semibold text-ink">
                    <Sparkles className="size-3" /> Best ratio
                  </span>
                )}
              </div>
              <div className="no-scrollbar mt-3 overflow-x-auto">
                <DayStrip w={w} />
              </div>
              <Link
                href={`/trips?window=${w.start}`}
                className="mt-3 flex items-center gap-1 text-sm font-medium text-pine hover:underline"
              >
                Trips for this window <ArrowRight className="size-4" />
              </Link>
            </motion.li>
          ))}
          {!bridges.length && <li className="h-40 animate-pulse rounded-2xl bg-paper/10" />}
        </ul>
      </section>

      <section className="mt-7">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarCheck2 className="size-4 text-pine" aria-hidden /> Already free, no days off needed
        </h2>
        <ul className="space-y-3">
          {calendar.map((w) => (
            <li key={w.start}>
              <Link
                href={`/trips?window=${w.start}`}
                className="block rounded-2xl border border-line bg-card p-4 shadow-soft transition-transform active:scale-[0.99]"
              >
                <div className="flex items-baseline justify-between">
                  <p className="font-display text-lg text-ink">{formatRange(w)}</p>
                  <p className="text-xs text-muted-foreground">
                    {dayCount(w)} days · {w.source === "gcal" ? "Google Calendar" : w.bridge?.holiday}
                  </p>
                </div>
                <div className="no-scrollbar mt-3 overflow-x-auto">
                  <DayStrip w={w} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Legend />
        </div>
      </section>

      <Link
        href="/trips"
        className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-pine text-base font-medium text-primary-foreground"
      >
        Show trips for all windows <ArrowRight className="size-4" />
      </Link>
    </AppShell>
  );
}
