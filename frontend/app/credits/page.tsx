"use client";

import { AppShell, PageTitle } from "@/components/shell";
import { DNA_DECK } from "@/lib/dna";
import { allCityPhotos, type PhotoCredit } from "@/lib/photos";

type Row = { key: string; title: string; src: string; credit: Pick<PhotoCredit, "author" | "license" | "source"> & { licenseUrl?: string } };

const CITY_ROWS: Row[] = allCityPhotos().map((p) => ({ key: p.src, title: p.city, src: p.src, credit: p }));
// Travel DNA cards with their own photos; the ones that reuse a city photo are already listed above.
const DECK_ROWS: Row[] = DNA_DECK.filter((c) => c.image.startsWith("/swipe/")).map((c) => ({
  key: c.id,
  title: c.short.en.charAt(0).toUpperCase() + c.short.en.slice(1),
  src: c.image,
  credit: c.credit,
}));

function CreditList({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ key, title, src, credit }) => (
        <li key={key} className="flex items-center gap-3 py-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" className="size-12 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1 text-sm leading-snug">
            <p className="font-medium text-ink">{title}</p>
            <p className="text-ink-soft">
              {credit.author} ·{" "}
              {credit.licenseUrl ? (
                <a href={credit.licenseUrl} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
                  {credit.license}
                </a>
              ) : (
                credit.license
              )}{" "}
              ·{" "}
              <a href={credit.source} target="_blank" rel="noreferrer" className="text-pine underline decoration-pine/30 underline-offset-2 hover:decoration-pine">
                source
              </a>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Credits() {
  return (
    <AppShell back title="Back" nav={false}>
      <PageTitle eyebrow="Attribution" title="Photo credits">
        Every photo in TripAI is used under a free license (CC0, public domain, CC BY or CC BY-SA). Photos are resized and
        compressed; nothing else is changed. Tap “source” for the original and its full license terms.
      </PageTitle>
      <h2 className="mt-2 mb-1 text-xs font-semibold tracking-[0.14em] text-clay uppercase">Destinations</h2>
      <CreditList rows={CITY_ROWS} />
      <h2 className="mt-8 mb-1 text-xs font-semibold tracking-[0.14em] text-clay uppercase">Travel DNA cards</h2>
      <CreditList rows={DECK_ROWS} />
    </AppShell>
  );
}
