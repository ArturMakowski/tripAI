"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bookmark, CircleCheck, Luggage, Pencil, Star, Target } from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { PriceInline } from "@/components/money";
import { CityPhoto } from "@/components/rec-card";
import { AppShell, PageTitle } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { api, HttpError, type DataMode } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useHydrated, useTrip } from "@/lib/store";
import { headline, headlinePrice, loadTrips, localTrips, parseTarget, priceLine, surveyHref, targetReached, withItem, withoutItem } from "@/lib/trips";
import type { TripItem, TripsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

function PriceChip({ t: trip }: { t: TripItem }) {
  const { t, fmt } = useT();
  const m = t.myTrips;
  const line = priceLine(trip);
  const pp = (n: number) => (trip.travelers > 1 ? `${fmt.pln(n)}${t.money.perPersonShort}` : fmt.pln(n));
  const text =
    line.kind === "down"
      ? m.down(pp(line.amount))
      : line.kind === "up"
        ? m.up(pp(line.amount))
        : line.kind === "same"
          ? m.same
          : line.kind === "exactNow"
            ? m.exactNow(pp(line.amount))
          : line.kind === "estimate"
            ? m.estimate(pp(line.amount))
            : line.kind === "none"
              ? m.noPriceNow
              : trip.watched
                ? m.notChecked
                : m.notWatched;
  const tone =
    line.kind === "down" ? "bg-pine-soft text-pine-deep" : line.kind === "up" ? "bg-clay-soft text-clay" : "bg-paper-deep text-muted-foreground";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", tone)}
      title={trip.checked_at ? m.checked(fmt.relative(trip.checked_at)) : undefined}
    >
      {text}
      {trip.checked_at && line.kind !== "unchecked" && <span className="font-normal opacity-70">· {fmt.relative(trip.checked_at)}</span>}
    </span>
  );
}

function TargetEditor({
  trip,
  onSave,
  onStop,
  onClose,
}: {
  trip: TripItem;
  onSave: (pln: number | null) => Promise<string | null>;
  onStop: () => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useT();
  const m = t.myTrips;
  const id = useId();
  const [raw, setRaw] = useState(trip.target_pln != null ? String(trip.target_pln) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = parseTarget(raw);

  async function save(pln: number | null) {
    setBusy(true);
    setError(await onSave(pln));
    setBusy(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value != null) void save(value);
  }

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      onSubmit={submit}
      className="overflow-hidden"
    >
      <label htmlFor={id} className="sr-only">
        {m.targetLabel(trip.city)}
      </label>
      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <input
            id={id}
            autoFocus
            inputMode="numeric"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={String(Math.round(headlinePrice(trip) * 0.9))}
            className="tabular h-10 w-full rounded-xl border border-line bg-paper px-3 pr-10 text-sm text-ink outline-none focus:border-pine"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">zł</span>
        </div>
        <Button type="submit" size="sm" className="h-10 rounded-xl" disabled={busy || value == null}>
          {m.targetSave}
        </Button>
      </div>
      <div className="mt-1.5 flex gap-3 text-xs">
        {trip.target_pln != null && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className="text-clay hover:underline">
            {m.targetClear}
          </button>
        )}
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-ink">
          {m.targetCancel}
        </button>
        {trip.watched && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(await onStop());
              setBusy(false);
            }}
            className="ml-auto text-muted-foreground hover:text-clay"
          >
            {m.stopWatching}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-clay">
          {error}
        </p>
      )}
    </motion.form>
  );
}

function PlannedCard({
  trip,
  onTarget,
  onStop,
}: {
  trip: TripItem;
  onTarget: (trip: TripItem, pln: number | null) => Promise<string | null>;
  onStop: (trip: TripItem) => Promise<string | null>;
}) {
  const { t, fmt } = useT();
  const m = t.myTrips;
  const [editing, setEditing] = useState(false);
  const hit = targetReached(trip);
  const price = headline(trip);
  const KindIcon = trip.kind === "approved" ? CircleCheck : Bookmark;
  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line bg-card p-3 shadow-soft">
      <div className="flex gap-3">
        <CityPhoto rec={trip} thumb className="size-14 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 font-display text-lg leading-tight text-ink">
              <span className="truncate">{trip.city}</span>
              <KindIcon className="size-3.5 shrink-0 text-pine" aria-label={trip.kind === "approved" ? m.approved : m.saved} />
            </p>
            {/* same money as the card (moneyOf): per person + "2 480 zł razem" for a group; estimates muted */}
            <PriceInline rec={price.rec} className={cn(
                "shrink-0 text-right",
                price.estimate ? "max-w-[55%] text-xs" : trip.travelers > 1 ? "max-w-[55%] text-sm font-semibold text-ink" : "font-display text-lg text-ink",
              )} />
          </div>
          <p className="text-xs text-muted-foreground">
            {fmt.range(trip)} · {m.party(trip.travelers)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PriceChip t={trip} />
            <button
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                hit ? "border-pine bg-pine text-paper" : trip.target_pln != null ? "border-pine/40 text-pine-deep" : "border-dashed border-line text-ink-soft hover:border-pine/40",
              )}
            >
              <Target className="size-3.5" aria-hidden />
              {hit ? m.targetHit : trip.target_pln != null ? m.target(fmt.pln(trip.target_pln)) : m.setTarget}
              <Pencil className="size-3 opacity-60" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {editing && (
          <TargetEditor
            trip={trip}
            onClose={() => setEditing(false)}
            onStop={async () => {
              const err = await onStop(trip);
              if (!err) setEditing(false);
              return err;
            }}
            onSave={async (pln) => {
              const err = await onTarget(trip, pln);
              if (!err) setEditing(false);
              return err;
            }}
          />
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function PastCard({ trip }: { trip: TripItem }) {
  const { t, fmt } = useT();
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-soft">
      <CityPhoto rec={trip} thumb className="size-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg leading-tight text-ink">{trip.city}</p>
        <p className="text-xs text-muted-foreground">
          {fmt.range(trip)} {trip.start.slice(0, 4)}
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="rounded-xl">
        <Link href={surveyHref(trip)}>
          <Star data-icon="inline-start" /> {t.myTrips.rate}
        </Link>
      </Button>
    </li>
  );
}

export default function MyTripsPage() {
  const { t } = useT();
  const m = t.myTrips;
  const hydrated = useHydrated();
  const [data, setData] = useState<TripsResponse | null>(null);
  const [mode, setMode] = useState<DataMode>("live");

  const local = useCallback(() => {
    const s = useTrip.getState();
    return localTrips(s.approved, s.recs, s.tripTargets);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    loadTrips(local).then((r) => {
      if (!alive) return;
      setData(r.data);
      setMode(r.mode);
      useTrip.getState().setMode("trips", r.mode); // fixture fallback lights the header's "Demo data" badge
    });
    return () => {
      alive = false;
    };
  }, [hydrated, local]);

  async function setTarget(trip: TripItem, pln: number | null): Promise<string | null> {
    if (mode === "fixture") {
      useTrip.getState().setTripTarget(trip.id, pln);
      setData((d) => d && withItem(d, { ...trip, target_pln: pln }));
      return null;
    }
    try {
      const item = await api.setTripTarget(trip.id, pln);
      setData((d) => d && withItem(d, item));
      return null;
    } catch (err) {
      return err instanceof HttpError && err.status === 409 ? m.targetFull(data?.max_watched ?? 5) : m.targetError;
    }
  }

  async function stopWatching(trip: TripItem): Promise<string | null> {
    try {
      const item = await api.stopWatching(trip.id);
      setData((d) => d && (item ? withItem(d, item) : withoutItem(d, trip.id)));
      return null;
    } catch {
      return m.stopError;
    }
  }

  if (!data) {
    return (
      <AppShell>
        <PageTitle title={m.title} />
        <div className="space-y-3" aria-busy="true" aria-label={t.common.loading}>
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-paper-deep" />
          ))}
        </div>
      </AppShell>
    );
  }

  const empty = !data.planned.length && !data.past.length;
  if (empty) {
    return (
      <AppShell>
        <PageTitle title={m.title} />
        <div className="flex flex-col items-center py-12 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-pine-soft text-pine">
            <Luggage className="size-7" aria-hidden />
          </div>
          <p className="mt-4 font-display text-2xl text-ink">{m.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{m.emptySub}</p>
          <Button asChild size="lg" className="mt-6 h-12 rounded-2xl px-6 text-base">
            <Link href="/trips">
              {m.emptyCta} <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageTitle title={m.title}>{m.sub}</PageTitle>

      <section aria-labelledby="planned-h">
        <h2 id="planned-h" className="mb-2.5 text-sm font-semibold text-ink">
          {m.planned} <span className="text-muted-foreground">· {data.planned.length}</span>
        </h2>
        {data.planned.length ? (
          <ul className="space-y-2.5">
            {data.planned.map((trip) => (
              <PlannedCard key={trip.id} trip={trip} onTarget={setTarget} onStop={stopWatching} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {m.plannedEmpty}{" "}
            <Link href="/trips" className="font-medium text-pine hover:underline">
              {m.emptyCta} →
            </Link>
          </p>
        )}
      </section>

      {data.past.length > 0 && (
        <section aria-labelledby="past-h" className="mt-7">
          <h2 id="past-h" className="mb-2.5 text-sm font-semibold text-ink">
            {m.past} <span className="text-muted-foreground">· {data.past.length}</span>
          </h2>
          <ul className="space-y-2.5">
            {data.past.map((trip) => (
              <PastCard key={trip.id} trip={trip} />
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
