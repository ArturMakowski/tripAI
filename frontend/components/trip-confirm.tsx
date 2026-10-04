"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarHeart, Plane, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AirportPicker } from "@/components/airport-picker";
import { QuickDates } from "@/components/date-picker/free-dates-planner";
import { formatDates } from "@/components/date-picker/date-range-calendar";
import { PartyPicker } from "@/components/money";
import { Button } from "@/components/ui/button";
import { formatOrigins } from "@/lib/airports";
import { useT } from "@/lib/i18n";
import { useUsableRanges } from "@/lib/windows-store";
import { cn } from "@/lib/utils";

type Panel = "when" | "from" | null;

/** One row of the confirm card: label, the pre-filled value, and "Change" opening its editor in place. */
function Row({
  icon,
  label,
  value,
  open,
  onToggle,
  editLabel,
  action,
  sub,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  editLabel?: string;
  /** an inline control instead of "Change" (the party stepper) */
  action?: ReactNode;
  /** one small line under the value ("Najbliższy długi weekend") */
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <li className="px-4 py-3">
      <div className="flex min-h-11 items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <div className="truncate text-[15px] font-medium text-ink">{value}</div>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
        {action}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="min-h-11 shrink-0 rounded-full px-3 text-sm font-medium text-pine hover:bg-pine-soft"
          >
            {editLabel}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-2 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/**
 * After the deck (T19): dates, party and airports pre-filled on one card, each editable in place, and one
 * "Pokaż wyjazdy" tap. No separate DNA result stop: the persona shows as a card on /trips.
 */
export function TripConfirm({
  party,
  onParty,
  airports,
  onAirports,
  busy,
  onBack,
  onConfirm,
}: {
  party: number;
  onParty: (n: number) => void;
  airports: string[];
  onAirports: (next: string[]) => void;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t: all, lang } = useT();
  const t = all.onboarding;
  const ranges = useUsableRanges();
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const dates = ranges.length ? ranges.map((r) => formatDates(r, all.calendar.locale)).join(", ") : t.anyDates;
  const icon = "size-5 shrink-0 text-pine";

  return (
    <div className="flex min-h-[70dvh] flex-col pt-4 pb-6">
      <h1 className="font-display text-[1.9rem] leading-tight text-ink">{t.tripTitle}</h1>
      <p className="mt-1 text-[15px] text-ink-soft">{t.tripSub}</p>

      <ul className="mt-6 divide-y divide-line rounded-3xl border border-line bg-card shadow-soft" data-testid="trip-confirm">
        <Row
          icon={<CalendarHeart className={cn(icon, "text-clay")} aria-hidden />}
          label={t.rows.when}
          value={dates}
          sub={ranges[0]?.quick === "long" ? all.calendar.chipNextLongWeekend : undefined}
          open={panel === "when"}
          onToggle={() => toggle("when")}
          editLabel={panel === "when" ? t.done : t.change}
        >
          <QuickDates />
          <p className="mt-1 text-xs text-muted-foreground">{t.datesHint}</p>
        </Row>
        <Row
          icon={<Users className={icon} aria-hidden />}
          label={t.rows.who}
          value={t.people(party)}
          // the party stepper is always inline: one tap per person, no panel to open
          action={<PartyPicker compact hideIcon value={party} onChange={onParty} className="shrink-0" />}
        />
        <Row
          icon={<Plane className={icon} aria-hidden />}
          label={t.rows.from}
          value={formatOrigins(airports, lang)}
          open={panel === "from"}
          onToggle={() => toggle("from")}
          editLabel={panel === "from" ? t.done : t.change}
        >
          <AirportPicker value={airports} onChange={onAirports} />
        </Row>
      </ul>

      <div className="mt-auto flex items-center gap-3 pt-8">
        {/* Back = undo the last swipe, like the deck's own undo */}
        <Button variant="ghost" size="lg" className="h-12 rounded-2xl" onClick={onBack}>
          {t.back}
        </Button>
        <Button size="lg" className="h-12 flex-1 rounded-2xl text-base" disabled={!airports.length || busy} onClick={onConfirm}>
          {busy ? t.computing : t.showTrips} {!busy && <ArrowRight data-icon="inline-end" />}
        </Button>
      </div>
    </div>
  );
}
