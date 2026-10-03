"use client";

import { ArrowUpRight, BedDouble, Bus, Car, Footprints, Navigation, Star, TrainFront, TramFront, type LucideIcon } from "lucide-react";
import { derivedSource, formatDuration, formatKm, formatRating } from "@/lib/trip-details";
import type { HotelDetails, TransferOption } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";
import { SourceChip } from "./source-chip";
import { useT } from "@/lib/i18n";

const chip = "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-ink";

/** "Your stay": the property behind hotel_cost_pln. Numbers as chips; address and per-fact sources one tap away. */
export function StayBlock({ hotel }: { hotel: HotelDetails }) {
  const { t: { tripDetails: t } } = useT();
  const reviews = hotel.reviews != null ? t.reviews(hotel.reviews, hotel.reviews.toLocaleString(t.locale)) : null;
  const rating = hotel.rating != null ? formatRating(hotel.rating, t.locale) : null;
  const km = hotel.distance_to_center_km != null ? formatKm(hotel.distance_to_center_km, t.locale) : null;
  const distSource = derivedSource(hotel.source, "estimate:haversine");
  return (
    <div className="rounded-3xl border border-line bg-card px-4 pt-3 pb-1 shadow-soft">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-clay-soft text-clay" aria-hidden>
          <BedDouble className="size-3.5" />
        </span>
        {/* no price here: price_pln_total is per room under party pricing; the receipt line is the per-person figure */}
        <h4 className="min-w-0 flex-1 font-display text-lg leading-tight text-ink">{hotel.name}</h4>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rating && (
          <li className={chip}>
            <span aria-hidden>★</span>
            <span className="sr-only">{t.ratingAria(rating)}</span>
            <span className="tabular font-semibold" aria-hidden>
              {rating}
            </span>
            {reviews && <span className="text-ink-soft">({reviews})</span>}
          </li>
        )}
        {hotel.stars != null && hotel.stars > 0 && (
          <li className={chip}>
            <span className="text-sun" aria-hidden>
              {"★".repeat(Math.min(5, hotel.stars))}
            </span>
            <span className="sr-only">{t.starsAria(hotel.stars)}</span>
          </li>
        )}
        {km && (
          <li className={chip}>
            <Navigation className="size-3" aria-hidden />
            {t.fromCentre(km)}
          </li>
        )}
      </ul>
      <div className="flex items-center gap-2 pt-1">
        <SourceChip source={hotel.source} fetched_at={hotel.fetched_at} />
        {hotel.booking_url && (
          <a
            href={hotel.booking_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-pine hover:bg-pine-soft"
          >
            {t.bookHotel} <ArrowUpRight className="size-4" aria-hidden />
          </a>
        )}
      </div>
      {(hotel.address || km) && (
        <Disclosure summary={t.stayDetails} className="border-t border-line">
          <dl className="space-y-2 text-sm">
            {hotel.address && (
              <div>
                <dt className="text-xs text-muted-foreground">{t.address}</dt>
                <dd className="text-ink">{hotel.address}</dd>
              </div>
            )}
            {km && (
              <div>
                <dt className="text-xs text-muted-foreground">{t.toCentre}</dt>
                <dd className="tabular text-ink">
                  {km} km · {t.straightLine}
                </dd>
                <dd>
                  <SourceChip source={distSource} fetched_at={hotel.fetched_at} />
                </dd>
              </div>
            )}
          </dl>
        </Disclosure>
      )}
    </div>
  );
}

const MODE_ICON: Record<string, LucideIcon> = {
  public_transport: TramFront,
  train: TrainFront,
  bus: Bus,
  taxi: Car,
  drive: Car,
  walk: Footprints,
};

function TransferRow({ tr }: { tr: TransferOption }) {
  const { t: { tripDetails: t }, fmt } = useT();
  const Icon = MODE_ICON[tr.mode] ?? Star;
  const estimate = /osrm|estimate:/.test(tr.source);
  const facts = [
    tr.duration_min != null ? formatDuration(tr.duration_min) : null,
    tr.distance_km != null ? `${formatKm(tr.distance_km, t.locale)} km` : null,
    tr.price_pln != null ? fmt.pln(tr.price_pln) : null,
  ].filter(Boolean);
  return (
    <li className="flex gap-3 py-2.5">
      <span
        className={cn("grid size-8 shrink-0 place-items-center rounded-full", estimate ? "bg-sun-soft text-ink" : "bg-pine-soft text-pine")}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <p className="text-sm font-medium text-ink">
            {(t.mode as Record<string, string>)[tr.mode] ?? t.mode.other}
            {estimate && <span className="font-normal text-ink-soft"> · {tr.mode === "drive" ? t.driveEstimate : t.estimate}</span>}
          </p>
          {facts.length > 0 && <p className="tabular text-sm text-ink">{facts.join(" · ")}</p>}
        </div>
        {tr.note && <p className="truncate text-xs text-ink-soft" title={tr.note}>{tr.note}</p>}
        <SourceChip source={tr.source} fetched_at={tr.fetched_at} />
      </div>
    </li>
  );
}

/** Airport → hotel: the first option visible, the rest one tap away. OSRM rows are labelled as driving estimates. */
export function TransferList({ transfers }: { transfers: TransferOption[] }) {
  const { t: { tripDetails: t } } = useT();
  if (!transfers.length) return <p className="text-sm text-ink-soft">{t.noTransfers}</p>;
  const [first, ...rest] = transfers;
  return (
    <div className="rounded-3xl border border-line bg-card px-4 shadow-soft">
      <ul>
        <TransferRow tr={first} />
      </ul>
      {rest.length > 0 && (
        <Disclosure summary={t.moreTransfers(rest.length)} className="border-t border-line">
          <ul className="divide-y divide-line">
            {rest.map((tr, i) => (
              <TransferRow key={`${tr.mode}-${i}`} tr={tr} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
