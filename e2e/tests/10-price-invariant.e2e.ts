import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { guard, useDemoProfile } from './support/tripai.ts';

/**
 * Invariant for the top 3 trips: card total == receipt total == confirm total == flight + hotel (one traveller),
 * and the returning home's "Twój nr 1" (T16) is the /trips #1 with the same total and the same estimate label,
 * on every screen, and the hotel nights shown match the trip dates. It holds for exact prices AND for honest
 * estimates ("~1 650 zł · szacunek", e.g. when the SerpApi daily cap is used up): an estimate must read as one
 * ("~" + the word "szacunek"/"estimate") on all three screens, never as an exact price on any of them.
 * Fully deterministic (DOM reads, no model calls). Numbers are parsed in both formats:
 * "1,096 PLN" (EN) and "1 096 zł" (PL, with NBSP / narrow NBSP).
 */

interface Seen {
  total: number | null;
  /** the total reads as an estimate ("~", with "szacunek"/"estimate" on the screen) */
  estimate: boolean;
  flight: number | null;
  hotel: number | null;
  nights: number | null;
}

/** Runs in the page: reads the numbers off one screen of one trip. */
function readScreen(arg: { screen: 'home' | 'card' | 'receipt' | 'confirm'; id: string }) {
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

  // Since PR #31 every screen marks its money with data hooks (frontend/components/money.tsx, rec-card.tsx):
  // [data-testid="trip-total"] carries the per-person total, [data-line="flight"|"hotel"] each line's amount.
  const num = (el: Element | null | undefined) => {
    const v = el?.getAttribute('data-amount');
    return v == null ? null : Number(v);
  };
  const root =
    arg.screen === 'home'
      ? document.querySelector(`a[data-testid="home-top-pick"][href="/trips/${arg.id}"]`)
      : arg.screen === 'card'
        ? document.querySelector(`main li article:has(a[href="/trips/${arg.id}"])`)
        : document.querySelector('main');
  if (!root) return null;
  const total = root.querySelector('[data-testid="trip-total"]');
  // the visible number must agree with its data-amount (a stale hook would hide a display bug)
  const shown = amount(textOf(total));
  const flightLine = root.querySelector('[data-line="flight"]');
  const hotelLine = root.querySelector('[data-line="hotel"]');
  const totalText = textOf(total);
  // Card: the word sits in the total itself ("~1 650 zł · szacunek"); receipt/confirm: in the row label
  // ("Razem (szacunek) ~1 650 zł").
  const wordIn = arg.screen === 'card' || arg.screen === 'home' ? totalText : textOf(total?.closest('div.py-1\\.5') ?? root);
  return {
    total: shown != null && shown === num(total) ? shown : null,
    estimate: totalText.includes('~') && /szacunek|estimate/i.test(wordIn),
    flight: amount(textOf(flightLine)) ?? num(flightLine),
    hotel: amount(textOf(hotelLine)) ?? num(hotelLine),
    // card: "6–10 Jan · 4 nights"; receipt: the stay line; confirm: the hero "… · 5 nights"
    nights: nightsIn(arg.screen === 'receipt' ? textOf(hotelLine) : textOf(root)),
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
  // A saved profile makes / the returning home (T16), checked against the /trips #1 below.
  await useDemoProfile(browser, screen);
  await browser.goto('/trips');
  // The app-wide PL/EN switch in the header (stored, so it holds across the page loads below).
  await screen.getByRole('radio', lang).tap();
  // T23: one ranked list (no List/Swipe toggle); wait for it to render.
  await expect(browser.locator('main ul[aria-busy]').first()).toBeVisible({ timeout: 60_000 });
  const cards = browser.locator('main li:has(article a[href^="/trips/"])');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  // Wait for the final ranking (the list is aria-busy while loading or refining). Prices may still be
  // honest estimates afterwards ("~… · szacunek"); the invariant below holds for both.
  await expect(browser.locator('main ul[aria-busy="true"]')).toHaveCount(0, { timeout: 90_000 });

  // The numbers below are parsed in this screen's own format: "1,096 PLN" (EN) or "1 096 zł" (PL).
  await expect(browser.locator('main li article [data-testid="trip-total"]').first()).toContainText(lang === 'Polski' ? /zł/ : /PLN/);

  const hrefs = (await browser.evaluate(() =>
    [...document.querySelectorAll('main li article a[href^="/trips/"]')].slice(0, 3).map((a) => a.getAttribute('href') ?? ''),
  )) as string[];
  expect(hrefs.length, 'trips on screen').toBe(3);

  // The home "#1" (T16) is the first card on /trips: same trip, and (via `seen.home` below) the same total and label.
  await browser.goto('/');
  const homePick = browser.locator('[data-testid="home-top-pick"]');
  await expect(homePick).toBeVisible({ timeout: 30_000 });
  expect(await homePick.getAttribute('href'), 'home #1 = /trips #1').toBe(hrefs[0]);
  const home = (await browser.evaluate(readScreen, { screen: 'home', id: hrefs[0].replace('/trips/', '') })) as Seen | null;

  const problems: string[] = [];
  for (const href of hrefs) {
    const id = href.replace('/trips/', '');
    const expectedNights = nightsFromId(id);
    const seen: Record<string, Seen | null> = {};
    if (href === hrefs[0]) seen.home = home;

    await browser.goto('/trips');
    await expect(browser.locator(`main li article a[href="${href}"]`)).toBeVisible({ timeout: 60_000 });
    seen.card = (await browser.evaluate(readScreen, { screen: 'card', id })) as Seen | null;

    await browser.goto(href);
    await expect(browser.locator('main [data-line="flight"]')).toBeVisible({ timeout: 30_000 });
    seen.receipt = (await browser.evaluate(readScreen, { screen: 'receipt', id })) as Seen | null;
    const receiptBad = check(id, 'receipt', seen.receipt, expectedNights);

    await browser.goto(`${href}/confirm`);
    await expect(browser.locator('main [data-line="flight"]')).toBeVisible({ timeout: 30_000 });
    seen.confirm = (await browser.evaluate(readScreen, { screen: 'confirm', id })) as Seen | null;
    const confirmBad = check(id, 'confirm', seen.confirm, expectedNights);
    const cardBad = check(id, 'card', seen.card, expectedNights);

    const totals = Object.entries(seen).map(([k, v]) => `${k}=${v?.total ?? '?'}${v?.estimate ? ' (est.)' : ''}`);
    const distinct = new Set(Object.values(seen).map((v) => v?.total));
    const estimateFlags = new Set(Object.values(seen).map((v) => v?.estimate));
    const crossBad = [
      ...(distinct.size !== 1 ? [`${id}: totals differ across screens (${totals.join(', ')})`] : []),
      // an estimate on one screen must be labelled an estimate on all of them
      ...(estimateFlags.size !== 1 ? [`${id}: estimate label differs across screens (${totals.join(', ')})`] : []),
    ];
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
