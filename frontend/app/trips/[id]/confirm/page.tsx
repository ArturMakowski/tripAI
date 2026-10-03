"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { BedDouble, CalendarPlus, Check, ExternalLink, Hand, Plane, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { CityPhoto } from "@/components/rec-card";
import { AppShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { dayCount, formatPLN, formatRange } from "@/lib/format";
import { useTrip } from "@/lib/store";
import type { Recommendation } from "@/lib/types";
import { handoffLinks } from "@/lib/handoff";
import { useRecommendations } from "@/lib/use-recommendations";

function icsFor(rec: Recommendation) {
  const d = (iso: string) => iso.replaceAll("-", "");
  const end = new Date(`${rec.window.end}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TripAI//EN",
    "BEGIN:VEVENT",
    `UID:${rec.id}@tripai`,
    `DTSTART;VALUE=DATE:${d(rec.window.start)}`,
    `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replaceAll("-", "")}`,
    `SUMMARY:${rec.city} trip (TripAI, tentative)`,
    `DESCRIPTION:Estimated ${Math.round(rec.total_cost_pln)} PLN all-in. Not booked yet.`,
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

export default function ConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const { ranked } = useRecommendations();
  const approved = useTrip((s) => s.approved);
  const approve = useTrip((s) => s.approve);
  const [ok, setOk] = useState(false);

  const rec = ranked.find((r) => r.id === id);
  if (!rec) return <AppShell back="/trips">{null}</AppShell>;

  const done = approved.includes(rec.id);
  const nights = dayCount(rec.window) - 1;
  const links = handoffLinks(rec);

  return (
    <AppShell back={`/trips/${rec.id}`} title={rec.city} nav={false}>
      <div className="pt-2">
        <CityPhoto rec={rec} className="h-36 rounded-3xl">
          <div className="absolute right-4 bottom-3 left-4 flex items-end justify-between text-white">
            <div>
              <p className="font-display text-3xl leading-none">{rec.city}</p>
              <p className="mt-1 text-sm text-white/85">
                {formatRange(rec.window)} {rec.window.start.slice(0, 4)} · {nights} nights
              </p>
            </div>
            <p className="tabular font-display text-2xl">{formatPLN(rec.total_cost_pln)}</p>
          </div>
        </CityPhoto>

        <ul className="mt-5 divide-y divide-line rounded-3xl border border-line bg-card px-4 shadow-soft">
          <li className="flex items-center gap-3 py-3.5">
            <Plane className="size-5 text-pine" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-ink">Return flight KRK ⇄ {rec.iata}</p>
              <p className="text-muted-foreground">Quoted {formatPLN(rec.flight_cost_pln)}</p>
            </div>
          </li>
          <li className="flex items-center gap-3 py-3.5">
            <BedDouble className="size-5 text-pine" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-ink">{nights} nights, central 3★</p>
              <p className="text-muted-foreground">Quoted {formatPLN(rec.hotel_cost_pln)}</p>
            </div>
          </li>
        </ul>

        <AnimatePresence mode="wait">
          {!done ? (
            <motion.div key="ask" exit={{ opacity: 0, y: -8 }} className="mt-5">
              <div className="rounded-3xl bg-clay-soft p-4">
                <p className="flex items-center gap-2 font-display text-lg text-ink">
                  <Hand className="size-5 text-clay" /> Nothing is booked yet
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  TripAI is not a travel agent. When you approve, we open the partner sites with your dates filled in. You book and pay there,
                  and prices may have changed since we checked.
                </p>
                <label className="mt-4 flex items-start gap-3 text-sm text-ink">
                  <Checkbox checked={ok} onCheckedChange={(v) => setOk(v === true)} className="mt-0.5 size-5 bg-card" />I understand these
                  are estimates and I&rsquo;ll confirm the final price myself.
                </label>
              </div>
              <Button size="lg" className="mt-5 h-12 w-full rounded-2xl text-base" disabled={!ok} onClick={() => approve(rec.id)}>
                <ShieldCheck data-icon="inline-start" /> Approve this plan
              </Button>
              <Link href="/trips" className="mt-2 block py-2 text-center text-sm text-muted-foreground hover:text-ink">
                Not now. Keep watching for me.
              </Link>
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
              <div className="flex flex-col items-center text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 16 }}
                  className="grid size-14 place-items-center rounded-full bg-pine text-paper"
                >
                  <Check className="size-7" />
                </motion.div>
                <p className="mt-3 font-display text-2xl text-ink">Approved by you</p>
                <p className="mt-1 text-sm text-ink-soft">Book at these links. We&rsquo;ll watch prices until you do.</p>
              </div>
              <ul className="mt-5 space-y-2.5">
                {links.map((l) => (
                  <li key={l.url}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-2xl border border-line bg-card px-4 py-3.5 text-sm font-medium text-ink shadow-soft hover:border-pine/40"
                    >
                      {l.label}
                      <ExternalLink className="size-4 text-pine" />
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href={icsFor(rec)}
                    download={`tripai-${rec.id}.ics`}
                    className="flex items-center justify-between rounded-2xl border border-dashed border-line px-4 py-3.5 text-sm font-medium text-ink-soft hover:border-pine/40"
                  >
                    Hold the dates in my calendar (tentative)
                    <CalendarPlus className="size-4 text-pine" />
                  </a>
                </li>
              </ul>
              <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
                Affiliate links may earn TripAI a commission. That never changes the ranking.
              </p>
              <Link href="/survey" className="mt-4 block text-center text-sm font-medium text-pine hover:underline">
                Back from a trip? Tell us how it went →
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
