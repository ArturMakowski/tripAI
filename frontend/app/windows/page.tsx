"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, CalendarCheck2, Radar, Sparkles } from "lucide-react";
import { useState } from "react";
import { FreeDatesPlanner } from "@/components/date-picker/free-dates-planner";
import { AppShell, PageTitle } from "@/components/shell";
import { dayCount, eachDay } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { BridgeWindow, FreeWindow } from "@/lib/types";
import { bridgeFor, useWindows } from "@/lib/windows";
import { cn } from "@/lib/utils";

type DayKind = "weekend" | "holiday" | "off" | "free";

function dayKind(iso: string, b?: BridgeWindow): DayKind {
  if (b?.leave_days.includes(iso)) return "off";
  if (b?.holidays.some((h) => h.date === iso)) return "holiday";
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? "weekend" : "free";
}

const KIND_STYLE: Record<DayKind, string> = {
  weekend: "bg-pine-soft text-pine-deep",
  holiday: "bg-clay text-white",
  off: "border-2 border-dashed border-sun bg-sun-soft text-ink",
  free: "bg-sky-soft text-ink",
};

function DayStrip({ w, b }: { w: FreeWindow; b?: BridgeWindow }) {
  const { t, fmt } = useT();
  return (
    <div className="flex gap-1.5">
      {eachDay(w).map((iso, i) => {
        const k = dayKind(iso, b);
        return (
          <motion.div
            key={iso}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
            className={cn("flex w-10 flex-col items-center rounded-xl py-1.5", KIND_STYLE[k])}
            title={k === "holiday" ? b?.holidays.find((h) => h.date === iso)?.name : t.windows.dayTitle[k]}
          >
            <span className="text-[10px] font-medium uppercase opacity-75">{fmt.weekday(iso).slice(0, 2)}</span>
            <span className="tabular text-sm font-semibold">{Number(iso.slice(8))}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function Legend() {
  const { t } = useT();
  const items: [DayKind, string][] = [
    ["holiday", t.windows.legend.holiday],
    ["weekend", t.windows.legend.weekend],
    ["off", t.windows.legend.off],
    ["free", t.windows.legend.free],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[4px]", KIND_STYLE[k])} />
          {label}
        </span>
      ))}
    </div>
  );
}

const ratio = (b: BridgeWindow) => b.total_days / Math.max(1, b.leave_days.length);
const holidayNames = (b: BridgeWindow) => [...new Set(b.holidays.map((h) => h.name))].join(", ");

export default function WindowsPage() {
  const { windows, longWeekends } = useWindows();
  const [showAll, setShowAll] = useState(false);
  const { t, fmt } = useT();
  const tw = t.windows;

  const allBridges = longWeekends
    .filter((b) => b.leave_days.length > 0)
    .sort((a, b) => ratio(b) - ratio(a) || a.window.start.localeCompare(b.window.start));
  const bridges = showAll ? allBridges : allBridges.slice(0, 4);
  // Already free: calendar windows of 3+ days and holiday weekends that need no leave.
  const seen = new Set<string>();
  const calendar = [
    ...longWeekends.filter((b) => b.leave_days.length === 0).map((b) => ({ w: b.window, b })),
    ...windows.filter((w) => dayCount(w) >= 3).map((w) => ({ w, b: bridgeFor(w, longWeekends) })),
  ]
    .filter(({ w }) => !seen.has(w.start + w.end) && !!seen.add(w.start + w.end))
    .sort((x, y) => x.w.start.localeCompare(y.w.start));
  const weekends = windows.filter((w) => dayCount(w) < 3).length;

  return (
    <AppShell>
      <PageTitle eyebrow={tw.eyebrow} title={tw.title}>
        {tw.intro}
      </PageTitle>

      <FreeDatesPlanner />

      <section className="mt-7 rounded-3xl bg-ink p-5 text-paper shadow-lift">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <Radar className="size-5 text-sun" aria-hidden /> {tw.radarTitle}
        </h2>
        <p className="mt-1 text-sm text-paper/70">{tw.radarIntro}</p>

        <ul className="mt-4 space-y-3">
          {bridges.map((w, i) => (
            <motion.li
              key={w.window.start + w.window.end}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * i }}
              className="rounded-2xl bg-paper p-4 text-ink"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[1.35rem] leading-tight">
                    {tw.takePrefix} <span className="text-clay">{tw.takeOff(w.leave_days.length)}</span> →{" "}
                    {tw.totalDays(w.total_days)}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {holidayNames(w)} · {fmt.range(w.window)}
                  </p>
                </div>
                {i === 0 && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-sun-soft px-2 py-0.5 text-xs font-semibold text-ink">
                    <Sparkles className="size-3" /> {tw.bestRatio}
                  </span>
                )}
              </div>
              <div className="no-scrollbar mt-3 overflow-x-auto">
                <DayStrip w={w.window} b={w} />
              </div>
              <Link
                href={`/trips?window=${w.window.start}_${w.window.end}`}
                className="mt-3 flex items-center gap-1 text-sm font-medium text-pine hover:underline"
              >
                {tw.tripsForWindow} <ArrowRight className="size-4" />
              </Link>
            </motion.li>
          ))}
          {!bridges.length && <li className="h-40 animate-pulse rounded-2xl bg-paper/10" />}
        </ul>
        {allBridges.length > 4 && (
          <button onClick={() => setShowAll((v) => !v)} className="mt-3 w-full py-1 text-sm text-paper/70 hover:text-paper">
            {showAll ? tw.showFewer : tw.showAllBridges(allBridges.length)}
          </button>
        )}
      </section>

      <section className="mt-7">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarCheck2 className="size-4 text-pine" aria-hidden /> {tw.alreadyFree}
        </h2>
        <ul className="space-y-3">
          {calendar.map(({ w, b }) => (
            <li key={w.start + w.end}>
              <Link
                href={`/trips?window=${w.start}_${w.end}`}
                className="block rounded-2xl border border-line bg-card p-4 shadow-soft transition-transform active:scale-[0.99]"
              >
                <div className="flex items-baseline justify-between">
                  <p className="font-display text-lg text-ink">{fmt.range(w)}</p>
                  <p className="text-xs text-muted-foreground">
                    {tw.days(dayCount(w))} · {b ? holidayNames(b) : tw.googleCalendar}
                  </p>
                </div>
                <div className="no-scrollbar mt-3 overflow-x-auto">
                  <DayStrip w={w} b={b} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {weekends > 0 && <p className="mt-3 text-sm text-muted-foreground">{tw.plusWeekends(weekends)}</p>}
        <div className="mt-3">
          <Legend />
        </div>
      </section>

      <Link
        href="/trips"
        className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-pine text-base font-medium text-primary-foreground"
      >
        {tw.showAllTrips} <ArrowRight className="size-4" />
      </Link>
    </AppShell>
  );
}
