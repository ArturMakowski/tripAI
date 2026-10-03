import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard } from './support/tripai.ts';

/**
 * Invariant for the top 3 trips: card total == receipt TOTAL == confirm total == flight + hotel,
 * on every screen, and the hotel nights shown match the trip dates.
 * Fully deterministic (DOM reads, no model calls). Numbers are parsed in both formats:
 * "1,096 PLN" (EN) and "1 096 zł" (PL, with NBSP / narrow NBSP).
 */

interface Seen {
  total: number | null;
  flight: number | null;
  hotel: number | null;
  nights: number | null;
}

/** Runs in the page: reads the numbers off one screen of one trip. */
function readScreen(arg: { screen: 'card' | 'receipt' | 'confirm'; id: string }) {
  const amount = (raw: string | null | undefined): number | null => {
    if (!raw) return null;
    const m = raw.replace(/[  ]/g, ' ').match(/(\d[\d ,.]*)\s*(PLN|zł)/i);
    if (!m) return null;
    let n = m[1].replace(/ /g, '').replace(/[.,]$/, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) n = n.replace(/,/g, ''); // EN 1,096(.50)
    else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); // 1.096,50
    else n = n.replace(',', '.'); // PL 1096,50
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  };
  const nightsIn = (raw: string | null | undefined): number | null => {
    const m = (raw ?? '').match(/(\d+)\s*(night|noc)/i);
    return m ? Number(m[1]) : null;
  };
  const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').trim();
  const iconParent = (root: Element, icon: string) => root.querySelector(`svg.lucide-${icon}`)?.parentElement ?? null;

  if (arg.screen === 'card') {
    const card = document.querySelector(`main li a[href="/trips/${arg.id}"]`);
    if (!card) return null;
    return {
      total: amount(textOf(card.querySelector('p.font-display.text-2xl'))),
      flight: amount(textOf(iconParent(card, 'plane'))),
      hotel: amount(textOf(iconParent(card, 'bed-double'))),
      nights: nightsIn(textOf(card.querySelector('p.font-display.text-lg'))),
    };
  }
  if (arg.screen === 'receipt') {
    const rows = [...document.querySelectorAll('main div[id^="ev-"]')];
    const value = (el: Element | undefined) => amount(textOf(el?.querySelector('span.tabular')));
    // rows in order: return flight, hotel, then the "typical trip cost" baseline (not a line item)
    const hotelRow = rows.find((r) => /hotel|noc|night/i.test(textOf(r.querySelector('span'))));
    const flightRow = rows.find((r) => r !== hotelRow);
    const totalLine = [...document.querySelectorAll('main div.font-semibold')].find((d) => /^(total|razem|suma)/i.test(textOf(d)));
    return {
      total: value(totalLine),
      flight: value(flightRow),
      hotel: value(hotelRow),
      nights: nightsIn(textOf(hotelRow?.querySelector('span'))),
    };
  }
  const main = document.querySelector('main');
  if (!main) return null;
  const items = [...main.querySelectorAll('ul li')];
  const flightItem = items.find((li) => li.querySelector('svg.lucide-plane'));
  const hotelItem = items.find((li) => li.querySelector('svg.lucide-bed-double'));
  const header = main.querySelector('p.font-display.text-2xl')?.parentElement;
  return {
    total: amount(textOf(main.querySelector('p.tabular.font-display.text-2xl'))),
    flight: amount(textOf(flightItem?.querySelector('p.text-muted-foreground'))),
    hotel: amount(textOf(hotelItem?.querySelector('p.text-muted-foreground'))),
    nights: nightsIn(textOf(header)),
  };
}

/** AGP-20270101-20270103 -> 2 */
function nightsFromId(id: string): number | null {
  const m = id.match(/(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const a = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const b = Date.UTC(+m[4], +m[5] - 1, +m[6]);
  return Math.round((b - a) / 86_400_000);
}

for (const lang of ['English', 'Polski'] as const) {
test(`Price invariant (${lang}): top 3 trips add up the same on card, receipt and confirm, and nights match the dates`, { timeout: 240_000 }, async ({ app, screen, browser }) => {
  await guard(browser, app.baseUrl);
  await app.open('/trips');
  // The app-wide PL/EN switch in the header (stored, so it holds across the page loads below).
  await screen.getByRole('radio', lang).tap();
  const cards = browser.locator('main li:has(a[href^="/trips/"])');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  // Wait for final prices: while refining, totals read "~1,096 PLN" (cached estimate).
  await expect(browser.locator('main li a[href^="/trips/"] p.font-display.text-2xl').first()).not.toContainText('~', { timeout: 60_000 });

  // The numbers below are parsed in this screen's own format: "1,096 PLN" (EN) or "1 096 zł" (PL).
  await expect(browser.locator('main li a[href^="/trips/"] p.font-display.text-2xl').first()).toContainText(lang === 'Polski' ? /zł/ : /PLN/);

  const hrefs = (await browser.evaluate(() =>
    [...document.querySelectorAll('main li a[href^="/trips/"]')].slice(0, 3).map((a) => a.getAttribute('href') ?? ''),
  )) as string[];
  expect(hrefs.length, 'trips on screen').toBe(3);

  const problems: string[] = [];
  for (const href of hrefs) {
    const id = href.replace('/trips/', '');
    const expectedNights = nightsFromId(id);
    const seen: Record<string, Seen | null> = {};

    await browser.goto('/trips');
    await expect(browser.locator(`main li a[href="${href}"]`)).toBeVisible({ timeout: 60_000 });
    seen.card = (await browser.evaluate(readScreen, { screen: 'card', id })) as Seen | null;

    await browser.goto(href);
    await expect(screen.getByRole('heading', /^(receipt|paragon)$/i)).toBeVisible({ timeout: 30_000 });
    seen.receipt = (await browser.evaluate(readScreen, { screen: 'receipt', id })) as Seen | null;
    const receiptBad = check(id, 'receipt', seen.receipt, expectedNights);

    await browser.goto(`${href}/confirm`);
    await expect(browser.locator('main ul li:has(svg.lucide-plane)')).toBeVisible({ timeout: 30_000 });
    seen.confirm = (await browser.evaluate(readScreen, { screen: 'confirm', id })) as Seen | null;
    const confirmBad = check(id, 'confirm', seen.confirm, expectedNights);
    const cardBad = check(id, 'card', seen.card, expectedNights);

    const totals = Object.entries(seen).map(([k, v]) => `${k}=${v?.total ?? '?'}`);
    const distinct = new Set(Object.values(seen).map((v) => v?.total));
    const crossBad = distinct.size !== 1 ? [`${id}: totals differ across screens (${totals.join(', ')})`] : [];
    const bad = [...cardBad, ...receiptBad, ...confirmBad, ...crossBad];
    if (bad.length) {
      problems.push(...bad);
      // Evidence for the report: the confirm page is on screen now; the receipt is one navigation back.
      await app.screenshot(`invariant-${id}-confirm`);
      await browser.goto(href);
      await app.screenshot(`invariant-${id}-receipt`);
    }
    console.log(`[invariant ${lang}] ${id} nights=${expectedNights} ${JSON.stringify(seen)}`);
  }

  expect(problems, 'price / nights invariant violations').toEqual([]);
});
}

function check(id: string, where: string, s: Seen | null, nights: number | null): string[] {
  if (!s) return [`${id}: could not read the ${where} screen`];
  const out: string[] = [];
  if (s.total == null || s.flight == null || s.hotel == null) out.push(`${id} ${where}: missing number(s) ${JSON.stringify(s)}`);
  else if (Math.abs(s.flight + s.hotel - s.total) > 1)
    out.push(`${id} ${where}: flight ${s.flight} + hotel ${s.hotel} = ${s.flight + s.hotel} != total ${s.total}`);
  if (nights != null && s.nights != null && s.nights !== nights) out.push(`${id} ${where}: shows ${s.nights} nights, dates give ${nights}`);
  if (nights != null && s.nights == null && where !== 'confirm') out.push(`${id} ${where}: no night count shown`);
  return out;
}
