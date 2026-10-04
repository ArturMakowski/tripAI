// Captures real screenshots of the live TripAI app (iPhone 14, demo profile) for the pitch deck.
// Usage: TRIPAI_APP_URL=<frontend-url> node shots.mjs [en|pl] [outDir]   (default: both languages into ./shots)
// No SerpApi is spent beyond what the live backend allows: its own daily cap applies, and the deck never
// features a specific price (estimates are labelled as such in the app).
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// The live app's URL is not committed (public repo): pass it in the environment.
const APP = (process.env.TRIPAI_APP_URL || process.env.E2E_PROD_URL)?.replace(/\/$/, '');
if (!APP) {
  console.error('Set TRIPAI_APP_URL (or E2E_PROD_URL) to the live frontend URL, e.g. TRIPAI_APP_URL=<frontend-url> npm run shots.');
  process.exit(2);
}
const langs = process.argv[2] ? [process.argv[2]] : ['en', 'pl'];
const OUT = process.argv[3] || new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const META = path.join(OUT, 'meta.json');
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};

// UI strings (EN | PL), from frontend/lib/i18n/messages/*
const RX = {
  demo: /^(Use demo profile|Profil demo)$/,
  letsGo: /^(Let’s go|Zaczynamy|Start)$/,
  confirmTitle: /Ready\? Check and go\.|Gotowe\? Sprawdź i ruszamy\./,
  showTrips: /^(Show trips|Pokaż wyjazdy)$/,
  personaCard: /^(Why this\?|Skąd to\?)$/,
  nextLongWeekend: /Next long weekend|Najbliższy długi weekend/,
  lwList: /^(Long weekends this month|Długie weekendy w tym miesiącu)$/,
  like: /^(I want to go|Chcę tam)/,
  learned: /^(Learned|Nauczyliśmy|Zapamiętane)/,
  whyNow: /^(Why now|Dlaczego teraz)$/,
  list: /^(List|Lista)$/,
  swipe: /^(Swipe|Karty)$/,
  swipeHint: /Swipe right, left|Przesuń w prawo/,
  sources: /^(Sources|Źródła)$/,
  fits: /Why it fits you|Dlaczego pasuje/,
  returnFlight: /^(Return flight|Lot w obie strony)$/,
  runNow: /Run scan now|Uruchom skan teraz/,
  gate: /Push-worthy|Inbox only|Warte powiadomienia|Tylko w skrzynce/,
  scanDone: /options? checked|sprawdzon\w+ opcj\w+|Nothing new worth a ping|Nic nowego/,
};

const ONLY = process.env.SHOTS_ONLY ? process.env.SHOTS_ONLY.split(',') : null; // debug: run only these steps
// SHOTS_PART=onboarding|trips|all (default all): onboarding = first run (welcome → swipes → confirm → /trips persona card),
// trips = demo profile → ranking, receipt, inbox.
const PART = process.env.SHOTS_PART || 'all';
// Ola's answers to the 14 Travel DNA cards (q1..q12, then y1, y2) as arrow keys: up = "So me!", right = "That's me",
// down = "Depends", left = "Not me". She loves food and new places, avoids crowds.
const OLA_KEYS = ['ArrowUp', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowRight'];
const PERSONA_BUDGET_PLN = 1800; // Ola, the persona shared with the pitch video (t8)
const failed = [];
const browser = await chromium.launch();
for (const lang of langs) {
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    viewport: { width: 390, height: 844 },
    locale: lang === 'pl' ? 'pl-PL' : 'en-GB', // the app follows the browser language
    timezoneId: 'Europe/Warsaw',
  });
  // a returning visitor: the first-run intro and coach marks are already seen
  await ctx.addInitScript(() => {
    try {
      const tours = { trips: true, receipt: true, windows: true, inbox: true };
      localStorage.setItem('tripai-tutorial-v1', JSON.stringify({ intro: true, tours }));
    } catch {}
  });
  const p = await ctx.newPage();
  // fast phase only: no exact-date (paid) lookups are ever triggered from the capture
  await p.route(/\/recommendations(\?|$)/, (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('phase', 'fast');
    return route.continue({ url: u.toString() });
  });
  const m = (meta[lang] = ONLY || PART !== 'all' ? meta[lang] || {} : {});
  const step = async (name, fn) => {
    if (ONLY && !ONLY.includes(name)) return;
    try { await fn(); } catch (e) { failed.push(`${lang}/${name}`); console.warn(`WARN ${lang} ${name}: ${e.message.split('\n')[0]}`); }
  };
  const shot = async (name) => {
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/${lang}-${name}.png` });
    console.log(lang, name, new URL(p.url()).pathname);
  };
  // scroll so the element sits `offset` px below the top of the viewport
  const scrollToEl = async (loc, offset) => {
    await loc.waitFor({ timeout: 60000 });
    const y = await loc.evaluate((n, o) => n.getBoundingClientRect().top + window.scrollY - o, offset);
    await p.evaluate((y) => window.scrollTo(0, y), y);
  };
  const scrollTo = (text, offset = 90) => scrollToEl(p.getByText(text).first(), offset);
  // viewport rect of the smallest ancestor of `loc` at least `minH` px tall
  const boxOf = (loc, minH) =>
    loc.evaluate((n, minH) => {
      let el = n;
      while (el.parentElement && el.getBoundingClientRect().height < minH) el = el.parentElement;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, minH);

  // ---- Part 1: the first run, as a new user ----
  if (PART !== 'trips') {
    await step('welcome', async () => {
      await p.goto(APP + '/');
      await p.waitForTimeout(3000);
      await shot('welcome');
    });
    await step('onboarding', async () => {
      await p.goto(APP + '/');
      await p.waitForTimeout(2000);
      await p.getByRole('button', { name: RX.letsGo }).or(p.getByRole('link', { name: RX.letsGo })).first().click();
      await p.waitForTimeout(3500);
      await shot('dna');
      for (const [i, key] of OLA_KEYS.entries()) {
        await p.keyboard.press(key);
        await p.waitForTimeout(900);
        if (i === 5) await shot('dna-mid');
      }
      await p.getByText(RX.confirmTitle).first().waitFor({ timeout: 30000 });
      await p.waitForTimeout(1500);
      await shot('confirm');
      await p.getByRole('button', { name: RX.showTrips }).or(p.getByRole('link', { name: RX.showTrips })).first().click();
      await p.waitForURL(/\/trips/, { timeout: 30000 }).catch(() => {});
      await p.getByText(RX.personaCard).first().waitFor({ timeout: 60000 }).catch(async (e) => {
        console.log('DEBUG url', new URL(p.url()).pathname, (await p.evaluate(() => document.body.innerText)).slice(0, 600));
        throw e;
      });
      await p.waitForTimeout(6000);
      await p.evaluate(() => window.scrollTo(0, 0));
      await shot('persona');
    });
  }
  if (PART === 'onboarding') {
    m.capturedAt = new Date().toISOString();
    await ctx.close();
    fs.writeFileSync(META, JSON.stringify(meta, null, 2));
    continue;
  }

  // ---- Part 2: ranking, receipt, inbox ----
  // After the first run, Ola continues in the same session (her swiped profile, KRK, 7–11 Nov from the confirm).
  // With SHOTS_PART=trips alone, the demo profile + the next long weekend stand in for her.
  const firstRun = PART !== 'trips';

  // demo profile, then the next long weekend (7–11 Nov) on the calendar
  if (!firstRun) {
    await p.goto(APP);
    await p.waitForTimeout(2000);
    await p.getByText(RX.demo).last().click();
    await p.waitForTimeout(2500);
  }
  // Ola's budget (the deck persona): the same profile field the "Never show trips over…" control sets
  await p.evaluate((budget) => {
    const s = JSON.parse(localStorage.getItem('tripai-v3'));
    s.state.profile = { ...s.state.profile, budget_pln: budget };
    s.state.recs = [];
    s.state.recsMeta = null;
    localStorage.setItem('tripai-v3', JSON.stringify(s));
  }, PERSONA_BUDGET_PLN);
  if (!firstRun) {
    await p.goto(APP + '/windows');
    await p.waitForTimeout(4000);
    await p.getByText(RX.nextLongWeekend).first().click();
    await p.waitForTimeout(1500);
  }
  if (!firstRun) {
    await step('calendar', async () => {
      await scrollTo(RX.lwList, 150); // the long-weekend list, with 7–11 Nov added
      await shot('calendar');
    });
  }

  // 2. Ranked where + when (wait for the full phase: fit verdicts + explanations)
  await p.goto(APP + '/trips');
  await p.waitForTimeout(35000);
  await step('swipe', async () => {
    await p.getByText(RX.swipe).first().click();
    await p.waitForTimeout(2000);
    await scrollTo(RX.swipeHint, 60);
    await shot('swipe');
    // Ola's #1 as the app labels it ("Nice, 7–11 Nov, ~1,692 PLN · estimate"): the deck's closing line quotes it verbatim
    m.top = await p.locator('[aria-roledescription="swipe card"]').first().getAttribute('aria-label');
  });
  // one like: the toast says what it learned (a /reactions call; the reaction is this session's only)
  await step('swipe-learned', async () => {
    await p.getByRole('button', { name: RX.like }).first().click();
    await p.waitForTimeout(1800);
    await shot('swipe-learned');
  });
  await p.getByText(RX.list).first().click();
  await p.waitForTimeout(2500);
  const card = p.locator('a[href^="/trips/"]').first();
  const href = (await card.getAttribute('href')).split('/').slice(0, 3).join('/');
  await step('cards', async () => {
    const firstCard = p.locator('article, li').filter({ has: p.locator('a[href^="/trips/"]') }).first();
    await scrollToEl((await firstCard.count()) ? firstCard : card, 72);
    await shot('cards');
  });

  // 3. Returning-user home: "your #1 + your dates"
  await step('home', async () => {
    await p.goto(APP + '/');
    await p.waitForTimeout(6000);
    await shot('home');
  });

  // 4. The receipt: estimates labelled, sources open, why it fits
  await p.goto(APP + href);
  await p.getByText(RX.returnFlight).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(12000); // the receipt settles (full-phase data) before we open anything
  await step('receipt-sources', async () => {
    await p.getByRole('button', { name: RX.sources }).first().click();
    await p.waitForTimeout(1200);
    await shot('receipt-sources');
    m.receiptCard = await boxOf(p.getByText(RX.returnFlight).first(), 200);
  });
  await step('receipt-why', async () => {
    const why = p.getByRole('button', { name: RX.whyNow }).first();
    await why.click();
    await p.waitForTimeout(1200);
    await scrollToEl(why, 330);
    await shot('receipt-why');
    await why.click(); // close it again
    await p.waitForTimeout(600);
  });
  await step('receipt-fit', async () => {
    const fits = p.getByRole('button', { name: RX.fits }).first();
    await fits.click();
    await p.waitForTimeout(1200);
    await scrollToEl(fits, 60);
    await shot('receipt-fit');
  });

  // 5. Inbox: one real scan (the same DBOS workflow as the daily run) shows Jev's push decision
  await step('inbox', async () => {
    await p.goto(APP + '/inbox');
    await p.waitForTimeout(3000);
    // the UI no longer shows Jev's p; read it from the scan response
    const scanResp = p.waitForResponse((r) => r.url().includes('/scan/run') && r.request().method() === 'POST', { timeout: 240000 });
    await p.getByRole('button', { name: RX.runNow }).click();
    const body = await (await scanResp).json().catch(() => ({}));
    // a notification (with Jev's push decision) or, if nothing new is worth it, the scan summary alone
    await p.getByText(RX.gate).or(p.getByText(RX.scanDone)).first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(2000);
    await scrollTo(RX.runNow, 220);
    await shot('inbox');
    const n = (body.notifications || [])[0] || {};
    m.inboxGate = { push: n.interrupt_ok === true, p: typeof n.interrupt_p === 'number' ? n.interrupt_p : null };
    if (body.run) m.scan = { windows: body.run.windows, candidates: body.run.candidates };
  });

  m.capturedAt = new Date().toISOString();
  await ctx.close();
  fs.writeFileSync(META, JSON.stringify(meta, null, 2));
}
await browser.close();
if (failed.length) { console.error('Missing shots (UI changed?): ' + failed.join(', ')); process.exitCode = 1; }
