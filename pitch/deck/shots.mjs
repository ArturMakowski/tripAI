// Captures real screenshots of the live TripAI app (iPhone 14, demo profile) for the pitch deck.
// Usage: node shots.mjs [en|pl] [outDir]   (default: both languages into ./shots)
// No SerpApi is spent beyond what the live backend already caches (its daily cap is enforced server-side).
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// The live app's URL is not committed (public repo): pass it in the environment.
const APP = process.env.TRIPAI_APP_URL?.replace(/\/$/, '');
if (!APP) {
  console.error('Set TRIPAI_APP_URL to the live frontend URL (e.g. TRIPAI_APP_URL=<frontend-url> npm run shots).');
  process.exit(2);
}
const langs = process.argv[2] ? [process.argv[2]] : ['en', 'pl'];
const OUT = process.argv[3] || new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const META = path.join(OUT, 'meta.json');
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};
const failed = [];
const browser = await chromium.launch();
for (const lang of langs) {
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    viewport: { width: 390, height: 844 },
    locale: lang === 'pl' ? 'pl-PL' : 'en-GB',
    timezoneId: 'Europe/Warsaw',
  });
  const p = await ctx.newPage();
  const m = (meta[lang] = {});
  const step = async (name, fn) => {
    try { await fn(); } catch (e) { failed.push(`${lang}/${name}`); console.warn(`WARN ${lang} ${name}: ${e.message.split('\n')[0]}`); }
  };
  // viewport rect of the first element matching `text` (or its ancestor matching `up`)
  const rectOf = (text, up) =>
    p.getByText(text).first().evaluate((n, up) => {
      const el = up ? n.closest(up) : n;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, up);
  const shot = async (name) => {
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${lang}-${name}.png` });
    console.log(lang, name, new URL(p.url()).pathname);
  };
  // scroll so `text` sits `offset` px below the top of the viewport
  const scrollTo = async (text, offset = 90) => {
    const el = p.getByText(text).first();
    await el.waitFor({ timeout: 60000 });
    const y = await el.evaluate((n, o) => n.getBoundingClientRect().top + window.scrollY - o, offset);
    await p.evaluate((y) => window.scrollTo(0, y), y);
  };
  const dismissToast = async () => {
    const x = p.getByRole('button', { name: /^(Dismiss|Zamknij)$/ }).first();
    if (await x.isVisible().catch(() => false)) await x.click().catch(() => {});
  };
  const setLang = () =>
    p.evaluate((l) => {
      const raw = localStorage.getItem('tripai-v3');
      if (!raw) return;
      const s = JSON.parse(raw);
      s.state.deck = { ...s.state.deck, lang: l };
      localStorage.setItem('tripai-v3', JSON.stringify(s));
    }, lang);

  // 1. Travel DNA swipe deck (fresh visitor)
  await p.goto(APP + '/onboarding');
  await p.waitForTimeout(3000);
  // one app-wide PL/EN setting (PR #22): a fresh browser follows its locale, so pl-PL -> Polish UI
  await p.waitForTimeout(1500);
  await shot('dna');

  // demo profile
  await p.goto(APP);
  await p.waitForTimeout(1500);
  await p.getByText(/demo profile|profilu demo/i).last().click();
  await p.waitForTimeout(2500);
  await setLang();

  // 2. Free time: pick the next long weekend (7–11 Nov) on the calendar
  await p.goto(APP + '/windows');
  await p.waitForTimeout(5000);
  await p.getByText(/Next long weekend|Najbliższy długi weekend/).first().click();
  await p.waitForTimeout(1500);
  // open the radar on the story's window (7–11 Nov, Independence Day)
  await scrollTo(/Narodowe Święto Niepodległości/, 150);
  await shot('radar');

  // 3. Ranked where + when
  await p.goto(APP + '/trips');
  await p.getByText(/Why this, why now|Dlaczego to/).first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(25000); // let phase=full land (fit verdicts + explanations)
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot('push');
  // the proactive toast's box, so the deck can crop it from the real pixels
  m.toast = await p.getByRole('button', { name: /^(Dismiss|Zamknij)$/ }).first().evaluate((b) => {
    let el = b;
    while (el.parentElement && (el.getBoundingClientRect().width < 300 || el.getBoundingClientRect().height < 80)) el = el.parentElement;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const card = p.locator('a[href^="/trips/"]').first();
  const href = await card.getAttribute('href');
  const scrollToEl = async (loc, offset) => {
    const y = await loc.evaluate((n, o) => n.getBoundingClientRect().top + window.scrollY - o, offset);
    await p.evaluate((y) => window.scrollTo(0, y), y);
  };
  await dismissToast();
  await p.waitForTimeout(1500);
  const firstCard = p.locator('article, li').filter({ has: p.locator('a[href^="/trips/"]') }).first();
  await scrollToEl((await firstCard.count()) ? firstCard : card, 72);
  await shot('cards');

  // 4. Receipt ("Why this, why now"); each part is optional so a UI change only drops that shot
  await p.goto(APP + href.split('/').slice(0, 3).join('/'));
  await p.getByText(/Why this, why now|Dlaczego to, dlaczego teraz/i).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(6000);
  await shot('receipt-top');
  await step('receipt-fit', async () => {
    await scrollTo(/Fit with your Travel DNA|Why it fits you|Dopasowanie do Twojego DNA/i, 80);
    await shot('receipt-fit');
  });
  await step('receipt-sources', async () => {
    await scrollTo(/^(Return flight|Lot w obie strony)/i, 175);
    await shot('receipt-sources');
    m.receiptFlight = await rectOf(/^(Return flight|Lot w obie strony)/i);
  });

  // 5. Swipe on offers
  await p.goto(APP + '/trips');
  await p.waitForTimeout(8000);
  await dismissToast();
  await p.getByText(/^Swipe$/).first().click();
  await p.waitForTimeout(2500);
  await scrollTo(/Swipe right, left|Przesuń w prawo/i, 60);
  await shot('swipe');

  // 6. Inbox
  await p.goto(APP + '/inbox');
  await p.waitForTimeout(4000);
  await p.getByRole('button', { name: /^(Scan|Skanuj)$/ }).click();
  // the scan is the same DBOS workflow as the daily 07:00 run; it shows Jev's push gate ("Inbox only · p 0.68")
  await p.getByText(/Push-worthy|Inbox only|Warte powiadomienia|Tylko w skrzynce/).first().waitFor({ timeout: 240000 });
  await p.waitForTimeout(2000);
  await scrollTo(/Run the scan now|Uruchom skan teraz/, 300);
  await shot('inbox');
  const gate = (await p.getByText(/(Push-worthy|Inbox only|Warte powiadomienia|Tylko w skrzynce) · p [\d.,]+/).first().textContent()) || '';
  m.inboxGate = { push: /^(Push|Warte)/.test(gate), p: Number(gate.match(/p ([\d.,]+)/)?.[1].replace(',', '.')) };
  m.capturedAt = new Date().toISOString();
  await ctx.close();
  fs.writeFileSync(META, JSON.stringify(meta, null, 2));
}
await browser.close();
if (failed.length) { console.error('Missing shots (UI changed?): ' + failed.join(', ')); process.exitCode = 1; }
