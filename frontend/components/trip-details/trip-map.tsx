"use client";

import dynamic from "next/dynamic";
import { ArrowUpRight, MapPinned } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { appleDirectionsUrl, appleMapsUrl, googleDirectionsUrl, googleMapsUrl, hotelPlaceQuery, mapPins, type PinKind, type TripDetailsStrings } from "@/lib/trip-details";
import type { GeoPoint, HotelDetails } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

function Placeholder({ text }: { text: string }) {
  return (
    <div className="grid size-full place-items-center bg-pine-soft/60 text-xs text-ink-soft">
      <span className="flex items-center gap-1.5">
        <MapPinned className="size-4" aria-hidden /> {text}
      </span>
    </div>
  );
}

// Leaflet is ~150 kB with its CSS: only fetched when the map scrolls near the viewport.
function Loading() {
  const { t } = useT();
  return <Placeholder text={t.tripDetails.mapLoading} />;
}

const LeafletMap = dynamic(() => import("./leaflet-map"), { ssr: false, loading: () => <Loading /> });

const DOT: Record<PinKind, string> = { hotel: "bg-clay", airport: "bg-pine", centre: "bg-ink" };

const linkCls =
  "inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-full px-2 text-xs font-medium text-pine underline-offset-2 hover:bg-pine-soft hover:underline";

function LinkRow({ label, google, apple, t }: { label: string; google: string; apple: string; t: TripDetailsStrings }) {
  return (
    <div className="flex items-center gap-1 border-t border-line px-4" role="group" aria-label={t.openIn(label)}>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
      <a href={google} target="_blank" rel="noreferrer" className={linkCls}>
        {t.openGoogle} <ArrowUpRight className="size-3.5" aria-hidden />
      </a>
      <a href={apple} target="_blank" rel="noreferrer" className={linkCls}>
        {t.openApple} <ArrowUpRight className="size-3.5" aria-hidden />
      </a>
    </div>
  );
}

/** Hotel, airport and city-centre pins with a straight airport → hotel line, a dot legend and map links. */
export function TripMap({ hotel, city }: { hotel: HotelDetails; city: string }) {
  const { t: { tripDetails: t } } = useT();
  const pins = useMemo(() => mapPins(hotel, t), [hotel, t]);
  const route = useMemo<[GeoPoint, GeoPoint] | null>(
    () => (hotel.airport && hotel.location ? [hotel.airport, hotel.location] : null),
    [hotel.airport, hotel.location],
  );
  const kindLabel = useMemo(() => ({ hotel: t.pinHotel, airport: t.pinAirport, centre: t.pinCentre }), [t]);

  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  if (pins.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-soft">
      <div ref={box} className="relative isolate h-64 w-full">
        {near ? (
          <LeafletMap pins={pins} route={route} label={t.mapLabel(city)} kindLabel={kindLabel} openGoogle={t.openGoogle} openApple={t.openApple} />
        ) : (
          <Placeholder text={t.mapLoading} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-xs text-ink-soft">
        {pins.map((p) => (
          <span key={p.kind} className="inline-flex items-center gap-1.5" title={p.name}>
            <span className={cn("size-2.5 rounded-full", DOT[p.kind])} aria-hidden />
            {kindLabel[p.kind]}
          </span>
        ))}
        {route && <span className="ml-auto">┄ {t.mapRouteNote}</span>}
      </div>
      {hotel.location && (
        <LinkRow label={t.pinHotel} google={googleMapsUrl(hotel.location, hotelPlaceQuery(hotel))} apple={appleMapsUrl(hotel.location, hotel.name)} t={t} />
      )}
      {hotel.airport && hotel.location && (
        <LinkRow
          label={t.directions}
          google={googleDirectionsUrl(hotel.airport, hotel.location)}
          apple={appleDirectionsUrl(hotel.airport, hotel.location)}
          t={t}
        />
      )}
    </div>
  );
}
