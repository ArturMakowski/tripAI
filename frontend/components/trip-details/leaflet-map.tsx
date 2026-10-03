"use client";

/**
 * The Leaflet map itself. Only ever loaded through next/dynamic from trip-map.tsx, so Leaflet (and its CSS)
 * stays out of every other bundle. OpenStreetMap raster tiles, no API key, attribution always visible.
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { appleMapsUrl, googleMapsUrl, type MapPin, type PinKind } from "@/lib/trip-details";
import type { GeoPoint } from "@/lib/types";

const PIN_STYLE: Record<PinKind, { bg: string; glyph: string; size: number }> = {
  hotel: { bg: "var(--clay)", glyph: "H", size: 32 },
  airport: { bg: "var(--pine)", glyph: "✈", size: 30 },
  centre: { bg: "var(--ink)", glyph: "", size: 14 },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The hotel is a teardrop whose tip sits on the spot, so a nearby centre dot stays visible; the others are centred discs. */
function pinIcon(kind: PinKind): L.DivIcon {
  const { bg, glyph, size } = PIN_STYLE[kind];
  const drop = kind === "hotel";
  const shape = drop ? "border-radius:50% 50% 50% 0;transform:rotate(-45deg)" : "border-radius:9999px";
  const inner = drop ? `<span style="transform:rotate(45deg)">${glyph}</span>` : glyph;
  return L.divIcon({
    className: "tripai-pin",
    html: `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;${shape};background:${bg};color:#fff;font:600 ${Math.round(size * 0.45)}px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgb(0 0 0/.3)">${inner}</span>`,
    iconSize: [size, size],
    iconAnchor: drop ? [size / 2, size * 1.2] : [size / 2, size / 2],
    popupAnchor: [0, drop ? -size * 1.2 : -size / 2],
  });
}

export interface LeafletMapProps {
  pins: MapPin[];
  /** Straight line drawn between these points (airport -> hotel) when no route geometry exists. */
  route: [GeoPoint, GeoPoint] | null;
  label: string;
  kindLabel: Record<PinKind, string>;
  openGoogle: string;
  openApple: string;
}

export default function LeafletMap({ pins, route, label, kindLabel, openGoogle, openApple }: LeafletMapProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || pins.length === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const map = L.map(el, {
      zoomAnimation: !reduce,
      fadeAnimation: !reduce,
      markerZoomAnimation: !reduce,
      inertia: !reduce,
      scrollWheelZoom: false, // never hijack page scroll
      dragging: !coarse, // on phones one finger scrolls the page until the map is tapped
      keyboard: true,
    });
    if (coarse) map.once("click", () => map.dragging.enable());
    map.attributionControl.setPrefix(false);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    if (route) {
      L.polyline(
        route.map((p) => [p.lat, p.lon] as L.LatLngTuple),
        { color: "#2f6b5c", weight: 3, opacity: 0.8, dashArray: "6 8", interactive: false },
      ).addTo(map);
    }

    for (const pin of pins) {
      const { lat, lon } = pin.point;
      const popup =
        `<strong>${esc(pin.name)}</strong><br><span style="opacity:.7">${esc(kindLabel[pin.kind])}</span><br>` +
        `<a href="${googleMapsUrl(pin.point, pin.query)}" target="_blank" rel="noreferrer">${esc(openGoogle)}</a> · ` +
        `<a href="${appleMapsUrl(pin.point, pin.name)}" target="_blank" rel="noreferrer">${esc(openApple)}</a>`;
      L.marker([lat, lon], {
        icon: pinIcon(pin.kind),
        title: `${kindLabel[pin.kind]}: ${pin.name}`,
        alt: `${kindLabel[pin.kind]}: ${pin.name}`,
        keyboard: true,
        zIndexOffset: pin.kind === "centre" ? 1000 : 0,
      })
        .bindPopup(popup)
        // marker taps don't bubble to the map: let them unlock one-finger panning too
        .on("click", () => map.dragging.enable())
        .addTo(map);
    }

    const bounds = L.latLngBounds(pins.map((p) => [p.point.lat, p.point.lon] as L.LatLngTuple));
    if (pins.length === 1) map.setView(bounds.getCenter(), 15, { animate: false });
    else map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15, animate: false });

    return () => {
      map.remove();
    };
  }, [pins, route, kindLabel, openGoogle, openApple]);

  return <div ref={ref} role="region" aria-label={label} className="size-full" />;
}
