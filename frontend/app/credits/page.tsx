"use client";

import { AppShell, ModeBadge, PageTitle } from "@/components/shell";
import { DNA_DECK, licenseUrl } from "@/lib/dna";
import { useT, type Lang } from "@/lib/i18n";
import { allCityPhotos, type PhotoCredit } from "@/lib/photos";

type Row = { key: string; title: string; src: string; credit: Pick<PhotoCredit, "author" | "license" | "source"> & { licenseUrl?: string } };

const CITY_ROWS: Row[] = allCityPhotos().map((p) => ({ key: p.src, title: p.city, src: p.src, credit: p }));
const deckRows = (lang: Lang): Row[] =>
  DNA_DECK.map((c) => ({
    key: c.id,
    title: c.short[lang].charAt(0).toUpperCase() + c.short[lang].slice(1),
    src: c.image,
    credit: { ...c.credit, licenseUrl: licenseUrl(c.credit.license) },
  }));

function CreditList({ rows }: { rows: Row[] }) {
  const { t } = useT();
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
                {t.credits.source}
              </a>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Credits() {
  const { t, lang } = useT();
  return (
    <AppShell back title={t.common.back} nav={false}>
      <PageTitle eyebrow={t.credits.eyebrow} title={t.credits.title}>
        {t.credits.intro}
      </PageTitle>
      <p className="mb-5 flex items-center gap-2 text-sm text-ink-soft">
        {t.common.dataSource}: <ModeBadge />
      </p>
      <h2 className="mt-2 mb-1 text-xs font-semibold tracking-[0.14em] text-clay uppercase">{t.credits.destinations}</h2>
      <CreditList rows={CITY_ROWS} />
      <h2 className="mt-8 mb-1 text-xs font-semibold tracking-[0.14em] text-clay uppercase">{t.credits.dnaCards}</h2>
      <p className="mb-1 text-xs text-muted-foreground">{t.credits.cropped}</p>
      <CreditList rows={deckRows(lang)} />
    </AppShell>
  );
}
