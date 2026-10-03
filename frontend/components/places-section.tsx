"use client";

import { motion } from "motion/react";
import { ChevronDown, Compass, MapPin, UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { SourceTag } from "@/components/source-tag";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { placeFacts, placeSections, VISIBLE_PLACES, type DestinationPlaces, type PlaceItem } from "@/lib/places";
import type { TasteProfile } from "@/lib/types";

function Row({ p }: { p: PlaceItem }) {
  const { t, fmt } = useT();
  const c = t.receipt.places;
  const facts = placeFacts(p, fmt.locale).join(" · ");
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-ink">{p.name}</span>
          {/* every restaurant "matches" food: the chip only means something on activities */}
          {p.kind === "activity" && p.matches.length > 0 && (
            <span className="shrink-0 rounded-full bg-pine-soft px-1.5 py-px text-[11px] text-pine-deep">{c.forYou}</span>
          )}
        </span>
        {facts && <span className="tabular mt-0.5 block truncate text-xs text-muted-foreground">{facts}</span>}
      </span>
      {p.maps_url && <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  const cls = "-mx-2 flex items-center gap-3 rounded-xl px-2 py-2";
  return (
    <li>
      {p.maps_url ? (
        <a href={p.maps_url} target="_blank" rel="noreferrer" aria-label={c.openMaps(p.name)} className={`${cls} hover:bg-paper-deep`}>
          {body}
        </a>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function Group({ title, icon: Icon, items }: { title: string; icon: typeof Compass; items: PlaceItem[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, VISIBLE_PLACES);
  const hidden = items.length - VISIBLE_PLACES;
  return (
    <div className="py-1">
      <h3 className="flex items-center gap-1.5 pt-2 text-xs font-semibold tracking-[0.12em] text-clay uppercase">
        <Icon className="size-3.5" aria-hidden /> {title}
      </h3>
      <ul className="mt-1">
        {shown.map((p) => (
          <Row key={`${p.name}-${p.maps_url}`} p={p} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 py-1 text-xs text-pine underline-offset-2 hover:underline"
        >
          {open ? t.receipt.places.less : t.receipt.places.more(hidden)}
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * "Where to eat" / "What to do" on the receipt: Google Maps places (via Serper) for the
 * destination, re-ranked toward the user's interests. Hidden when there is nothing sourced to show.
 */
export function PlacesSection({ iata, profile }: { iata: string; profile: TasteProfile | null }) {
  const { t, lang } = useT();
  const c = t.receipt.places;
  const interests = profile?.interests;
  const key = `${iata}|${lang}|${JSON.stringify(interests ?? {})}`;
  // keyed, so a stale answer for another trip/language/profile is never shown
  const [got, setGot] = useState<{ key: string; data: DestinationPlaces | null } | null>(null);

  useEffect(() => {
    let live = true;
    api.places(iata, lang, interests).then((data) => {
      if (live) setGot({ key, data });
    });
    return () => {
      live = false;
    };
    // `key` covers iata, lang and the interests object (new identity on every store update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const data = got?.key === key ? got.data : null;
  if (!data) return null;
  const sections = placeSections(data);
  if (!sections.length) return null;
  const first = sections[0].items[0];
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 rounded-3xl border border-line bg-card px-4 pt-1 pb-3 shadow-soft"
      data-testid="places"
    >
      {sections.map((s, i) => (
        <div key={s.key} className={i > 0 ? "border-t border-dashed border-line" : undefined}>
          <Group title={s.key === "eat" ? c.eat : c.do} icon={s.key === "eat" ? UtensilsCrossed : Compass} items={s.items} />
        </div>
      ))}
      <SourceTag e={{ source: first.source, fetched_at: first.fetched_at, url: null }} />
    </motion.section>
  );
}
