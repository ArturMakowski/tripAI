"use client";

import { ArrowUpRight, Plane } from "lucide-react";
import { Fragment } from "react";
import { airlinesOf, arrivesNextDay, clock, formatDuration, journeyMin, layoverMin, legDay, stopsLabel, type TripDetailsStrings } from "@/lib/trip-details";
import type { FlightDetails, FlightLeg } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";
import { SourceChip } from "./source-chip";
import { useT } from "@/lib/i18n";

const NextDay = ({ leg, t }: { leg: FlightLeg; t: TripDetailsStrings }) =>
  arrivesNextDay(leg) ? <sup className="ml-0.5 text-[10px] font-semibold text-clay">{t.nextDay}</sup> : null;

/** One direction on one line: "Tam · czw., 14 sty   06:25 KRK → 08:30 FCO   [bezpośredni · 2 h 05]". */
function DirectionRow({ title, legs, stops, t }: { title: string; legs: FlightLeg[]; stops: number | null; t: TripDetailsStrings }) {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const dur = journeyMin(legs);
  return (
    <div className="py-2">
      <p className="text-xs text-muted-foreground">
        {title}
        {first.depart_at && ` · ${legDay(first.depart_at, t.locale)}`}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="tabular text-[15px] font-semibold text-ink">
          {first.depart_at && <>{clock(first.depart_at)} </>}
          <span className="font-mono text-xs font-medium text-ink-soft">{first.from_iata}</span>
          <span className="px-1 text-ink-soft">→</span>
          {last.arrive_at && (
            <>
              {clock(last.arrive_at)}
              <NextDay leg={last} t={t} />{" "}
            </>
          )}
          <span className="font-mono text-xs font-medium text-ink-soft">{last.to_iata}</span>
        </p>
        {stops != null ? (
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
              stops === 0 ? "bg-pine-soft text-pine-deep" : "bg-sun-soft text-ink",
            )}
          >
            {stopsLabel(stops, t)}
            {dur != null && ` · ${formatDuration(dur)}`}
          </span>
        ) : (
          !first.depart_at && <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t.timesPending}</span>
        )}
      </div>
    </div>
  );
}

/** Expanded: every leg with its flight number, duration and the layover between legs. */
function Legs({ legs, t }: { legs: FlightLeg[]; t: TripDetailsStrings }) {
  return (
    <ol className="space-y-1.5">
      {legs.map((leg, i) => {
        const next = legs[i + 1];
        const wait = next ? layoverMin(leg, next) : null;
        return (
          <Fragment key={`${leg.from_iata}-${leg.to_iata}-${i}`}>
            <li className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink">
              <span className="tabular">
                {leg.depart_at && `${clock(leg.depart_at)} `}
                {leg.from_iata} → {leg.arrive_at && clock(leg.arrive_at)}
                <NextDay leg={leg} t={t} /> {leg.to_iata}
              </span>
              <span className="text-xs text-ink-soft">
                {[leg.flight_number, leg.airline, leg.duration_min != null ? formatDuration(leg.duration_min) : null].filter(Boolean).join(" · ")}
              </span>
            </li>
            {next && (
              <li className="text-xs text-clay">
                ↳ {wait != null ? t.changeIn(leg.to_iata, formatDuration(wait)) : t.changeInNoTime(leg.to_iata)}
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}

/** "Your flight": the exact itinerary behind flight_cost_pln. Every unknown field is hidden. */
export function FlightBlock({ flight }: { flight: FlightDetails }) {
  const { t: { tripDetails: t } } = useT();
  const airline = airlinesOf([...flight.outbound, ...flight.inbound]);
  const hasLegDetails = [...flight.outbound, ...flight.inbound].some((l) => l.flight_number || l.depart_at);
  return (
    <div className="rounded-3xl border border-line bg-card px-4 pt-3 pb-1 shadow-soft">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-pine-soft text-pine" aria-hidden>
          <Plane className="size-3.5" />
        </span>
        {/* no price here: the receipt line above is the one per-person figure (docs/BUDGET.md money consistency) */}
        <p className="min-w-0 flex-1 truncate font-display text-lg leading-tight text-ink">{airline}</p>
      </div>
      <div className="mt-1 divide-y divide-dashed divide-line">
        {flight.outbound.length > 0 && <DirectionRow title={t.outbound} legs={flight.outbound} stops={flight.stops_outbound} t={t} />}
        {flight.inbound.length > 0 && <DirectionRow title={t.inbound} legs={flight.inbound} stops={flight.stops_inbound} t={t} />}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <SourceChip source={flight.source} fetched_at={flight.fetched_at} />
        {flight.booking_url && (
          <a
            href={flight.booking_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-pine hover:bg-pine-soft"
          >
            {t.bookFlight} <ArrowUpRight className="size-4" aria-hidden />
          </a>
        )}
      </div>
      {hasLegDetails && (
        <Disclosure summary={t.legDetails} className="border-t border-line">
          <div className="space-y-3">
            {flight.outbound.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-clay">{t.outbound}</p>
                <Legs legs={flight.outbound} t={t} />
              </div>
            )}
            {flight.inbound.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-clay">{t.inbound}</p>
                <Legs legs={flight.inbound} t={t} />
              </div>
            )}
            <SourceChip source={flight.source} fetched_at={flight.fetched_at} />
          </div>
        </Disclosure>
      )}
    </div>
  );
}
