// Records every piece of real footage the video uses from the LIVE app, in one command per language:
//   node capture.mjs --lang en|pl [--part onboarding|trips] [--record] [--allow-one-full]
// The frontend URL comes from E2E_PROD_URL (env, or ../../.env, or $TRIPAI_ENV_FILE); the repo is public, so no URL
// is ever written to a committed file. The backend is private: everything goes through the frontend's /api proxy.
//
// One continuous user session: swipe Travel DNA → dates → persona → ranked trips (swipe deck) → trip page →
// sources / evidence → approve → My trips (target price) → returning home.
// /api calls are recorded once to footage/<lang>/api.har (--record, or when it is missing) and replayed on every
// later take, so footage is deterministic and re-takes never reach the backend. Spend guard while recording: every
// full /recommendations is sent as phase=fast (cache + Travelpayouts + seed only, never SerpApi), as in e2e/.
//
// Outputs footage/<lang>/: <clip>/NNNN.jpg (30 fps, 1170x2532), <still>.png full-page shots with fixed/sticky chrome
// removed, <still>.view.png (viewport at scroll 0, the chrome is cropped from it), and meta.json (element boxes in
// CSS px, pointer events per clip, flow facts like the #1 city and dates).
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en';
// --part onboarding: welcome → 14 swipes → the pre-filled confirm → /trips with the persona card
// --part trips:      ranked trips → swipe deck → trip page → evidence → approve → My trips → home (onboarding unrecorded)
const ALLOW_FULL = args.includes('--allow-one-full');
const PART = args.includes('--part') ? args[args.indexOf('--part') + 1] : 'all';
const PARTS = PART === 'all' ? ['onboarding', 'trips'] : [PART];
const FINAL = path.join(HERE, 'footage', LANG);
// a take starts as a copy of the current footage, is written next to it and swapped in only when it completes
const OUT = FINAL + '.take';
const HAR = path.join(OUT, `api-${PART}.har`);
const RECORD = args.includes('--record') || !fs.existsSync(path.join(FINAL, `api-${PART}.har`));
fs.rmSync(OUT, { recursive: true, force: true });
if (fs.existsSync(FINAL)) fs.cpSync(FINAL, OUT, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const FPS = 30;
const DPR = 3;
const VIEW = { width: 390, height: 844 }; // the full iPhone 14 screen, as the installed PWA (no browser chrome)

function appUrl() {
  if (process.env.E2E_PROD_URL) return process.env.E2E_PROD_URL;
  for (const f of [process.env.TRIPAI_ENV_FILE, path.join(HERE, '../../.env'), path.join(process.env.HOME, 'Documents/TripAI/.env')]) {
    if (!f || !fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, 'utf8').match(/^E2E_PROD_URL=["']?([^"'\n]+)/m);
    if (m) return m[1];
  }
  throw new Error('set E2E_PROD_URL=<frontend-url> (env or .env)');
}
const APP = appUrl().replace(/\/$/, '');
const API = new RegExp('^' + APP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/api/');

// The demo persona: answers to q1..q12, y1, y2 (U = "So me!", R = "That's me", D = "Depends", L = "Not me").
// Ola from the deck: loves discovering, local food, rest; price-aware; hates crowds.
const ANSWERS = (process.env.ANSWERS || 'U L R R U R D R R D U L R R').split(' ');
const GESTURE = { U: /\(↑\)/, L: /\(←\)/, R: /\(→\)/, D: /\(↓\)/ };
const DRAG = { U: [0, -340], L: [-270, 30], R: [270, -20], D: [0, 300] };
const BUDGET = Number(process.env.BUDGET ?? 1800); // PLN per person, Ola's budget in the deck (0 = no hard limit)
const SWIPE_IMAGES = [...fs.readFileSync(path.join(HERE, '../../frontend/lib/dna.ts'), 'utf8').matchAll(/image: "([^"]+)"/g)].map((m) => m[1]);

const rx = (en, pl) => new RegExp(`${en}|${pl}`, 'i');
const T = {
  letsGo: rx('^let.?s go', '^zaczynamy|^jedziemy|^start'),
  showTrips: rx('^show trips', '^pokaż (wyjazdy|podróże)'),
  persona: rx('^the [a-z-]+ [a-z-]+$|explorer|foodie|traveller|traveler', 'odkryw|podróżni|smakosz'),
  longWeekend: rx('long weekend', 'długi weekend'),
  showDna: rx('^show my dna', '^pokaż moje dna'),
  looksRight: rx('looks right', 'wygląda dobrze|zgadza się|dalej'),
  ready: rx('ranking updated|live prices in', 'ranking zaktualizowany|ceny na żywo|zaktualizowan'),
  sources: rx('^sources$', '^źródła$'),
  evidence: rx('^evidence', '^dowody|^źródła danych'),
  confirmSelf: rx("confirm the final price", 'cenę potwierdzę|potwierdzę u partnera'),
  approve: rx('^approve', '^zatwierdź|^akceptuj'),
  seeMyTrips: rx('my trips', 'moje podróże'),
  setPrice: rx('set your price', 'twoja cena|ustaw'),
  plan: rx('^plan this trip', '^zaplanuj'),
};

fs.mkdirSync(OUT, { recursive: true });
const prevMeta = fs.existsSync(path.join(OUT, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8')) : {};
const meta = { clips: {}, stills: {}, flow: {}, ...prevMeta, lang: LANG, dpr: DPR, fps: FPS, view: VIEW };
meta.captured = { ...(prevMeta.captured || {}), ...Object.fromEntries(PARTS.map((p) => [p, new Date().toISOString()])) };
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ args: [`--force-device-scale-factor=${DPR}`] }); // screencast at device pixels
const ctx = await browser.newContext({
  ...devices['iPhone 14'],
  viewport: VIEW,
  locale: LANG === 'pl' ? 'pl-PL' : 'en-GB',
  timezoneId: 'Europe/Warsaw',
});
// first-run tutorial counts as seen, so no coach marks sit on top of the flow
await ctx.addInitScript(() => {
  try {
    if (!localStorage.getItem('tripai-tutorial-v1'))
      localStorage.setItem('tripai-tutorial-v1', JSON.stringify({ intro: true, tours: { trips: true, receipt: true, windows: true, inbox: true } }));
  } catch {}
});
if (RECORD) {
  await ctx.routeFromHAR(HAR, { url: API, update: true, updateContent: 'embed' });
} else {
  // replay: /recommendations only ever from the recording (a miss is aborted, never sent live); other /api misses go live
  await ctx.routeFromHAR(HAR, { url: /\/api\/(?!recommendations)/, notFound: 'fallback' });
  await ctx.routeFromHAR(HAR, { url: /\/api\/recommendations/, notFound: 'abort' });
}
let fulls = 0;
// President decision (4 Oct, cap at 60/60 so the backend cannot search SerpApi): exactly ONE full call per take, the one
// that loads Ola's ranked trips (fit verdicts exist only in the full phase). Everything else goes out as phase=fast.
let allowFull = false;
let fullsAllowed = 0;
let holdRecs = false; // while true, /recommendations is not sent at all (set-up steps before the real load)
await ctx.route(/\/api\/recommendations/, (route) => {
  if (holdRecs) return route.abort();
  const u = new URL(route.request().url());
  if (route.request().method() === 'POST' && u.searchParams.get('phase') !== 'fast') {
    // replay mirrors the recording: the same one call stays full (served from the HAR), the rest become fast
    if (allowFull && (ALLOW_FULL || !RECORD) && fullsAllowed === 0) {
      fullsAllowed += 1;
      allowFull = false;
      log('  guard: the one allowed full /recommendations of this take');
      return route.fallback();
    }
    u.searchParams.set('phase', 'fast');
    log(`  guard: full /recommendations #${++fulls} sent as phase=fast (cache only, never SerpApi)`);
    return route.fallback({ url: u.toString() });
  }
  return route.fallback();
});
const page = await ctx.newPage();
// A failed take keeps what it recorded: the HAR goes next to the footage, so a re-run (without --record) replays it
// instead of calling the backend again (the one allowed full call is never repeated).
process.on('uncaughtException', async (e) => {
  log('FAILED:', e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(OUT, 'debug-failed.png') }).catch(() => {});
  await ctx.close().catch(() => {});
  fs.mkdirSync(FINAL, { recursive: true });
  if (fs.existsSync(HAR)) { fs.copyFileSync(HAR, path.join(FINAL, path.basename(HAR))); log('  kept', path.basename(HAR), 'for a replay re-run'); }
  process.exit(1);
});
page.on('requestfailed', (r) => { if (API.test(r.url())) log('  ! failed', r.method(), r.url().replace(APP, ''), r.failure()?.errorText); });

// ------------------------------------------------------------------------------------------------ helpers
let rec = null; // the running screencast, if any

async function startClip(name) {
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const events = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ t: f.metadata.timestamp, d: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width * DPR, maxHeight: VIEW.height * DPR });
  const t0 = Date.now() / 1000;
  rec = {
    mark: (ev) => events.push({ t: +(Date.now() / 1000 - t0).toFixed(3), ...ev }),
    async stop() {
      await page.waitForTimeout(250);
      await cdp.send('Page.stopScreencast');
      await cdp.detach().catch(() => {});
      const dir = path.join(OUT, name);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const n = Math.floor((Date.now() / 1000 - t0) * FPS);
      let j = 0;
      for (let k = 0; k < n && frames.length; k++) {
        while (j + 1 < frames.length && frames[j + 1].t <= t0 + k / FPS) j++;
        fs.writeFileSync(path.join(dir, `${String(k).padStart(4, '0')}.jpg`), Buffer.from(frames[j].d, 'base64'));
      }
      meta.clips[name] = { frames: n, events };
      log(`clip ${name}: ${frames.length} raw → ${n} frames (${(n / FPS).toFixed(1)} s)`);
      rec = null;
    },
  };
  return rec;
}

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Tap a locator like a person: the pointer travels there first (logged for the composited cursor). */
async function tap(locator, label) {
  const l = locator.filter({ visible: true }).first();
  await l.scrollIntoViewIfNeeded();
  const b = await l.boundingBox();
  const c = center(b);
  rec?.mark({ type: 'move', x: c.x, y: c.y, label });
  await page.mouse.move(c.x, c.y, { steps: 8 });
  await page.waitForTimeout(120);
  rec?.mark({ type: 'tap', x: c.x, y: c.y, w: b.width, h: b.height, label });
  await l.click();
}

/** Eased pointer drag so the app's own drag physics play; logs the path for the composited cursor. */
async function drag(from, to, ms = 520) {
  rec?.mark({ type: 'down', x: from.x, y: from.y });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(90);
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) {
    const e = 1 - Math.pow(1 - i / steps, 3);
    const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e;
    await page.mouse.move(x, y);
    rec?.mark({ type: 'move', x: +x.toFixed(1), y: +y.toFixed(1) });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  rec?.mark({ type: 'up', x: to.x, y: to.y });
}

/** Box in document coordinates (CSS px) of the first match, or null. */
async function docBox(locator) {
  const l = locator.first();
  if (!(await l.count())) return null;
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  });
}

/** Lazy content (images, map) loads only when scrolled into view: walk the page once. */
async function warmScroll() {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 300) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
}

/** Full-page still with fixed/sticky chrome removed + the viewport (chrome source) + target boxes. */
async function still(name, targets = {}) {
  await warmScroll();
  const boxes = {};
  for (const [k, loc] of Object.entries(targets)) boxes[k] = await docBox(loc);
  const chrome = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20 || r.height > innerHeight * 0.6 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (out.some((o) => o.el.contains(el))) continue;
      out.push({ el, r: { x: r.x, y: r.y, w: r.width, h: r.height }, edge: r.y + r.height / 2 < innerHeight / 2 ? 'top' : 'bottom' });
    }
    out.forEach((o, i) => o.el.setAttribute('data-pitch-chrome', i));
    return out.map(({ r, edge }) => ({ ...r, edge }));
  });
  await page.screenshot({ path: path.join(OUT, `${name}.view.png`) });
  // hide the whole subtree: a child with visibility:visible would show through a hidden parent
  const tag = await page.addStyleTag({ content: '[data-pitch-chrome],[data-pitch-chrome] *{visibility:hidden!important}' });
  const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await tag.evaluate((el) => el.remove());
  meta.stills[name] = { ...size, chrome, boxes };
  log(`still ${name}: ${size.w}x${size.h}, chrome ${chrome.length}, boxes`, Object.keys(boxes).filter((k) => boxes[k]).join(','));
}

async function waitReady(timeout = 60000) {
  await page.getByText(T.ready).first().waitFor({ timeout }).catch(() => log('  (no "ranking updated" text)'));
  await page.waitForTimeout(1200);
}

// ------------------------------------------------------------------------------------------------ the flow
const recording = (part) => PARTS.includes(part);

// 1. Welcome → "Let's go" → the Travel DNA deck: the first five cards by real drags, the rest with the buttons.
await page.goto(APP + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
if (recording('onboarding')) await still('welcome');
await page.evaluate(async (srcs) => { await Promise.all(srcs.map((s) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = s; }))); }, SWIPE_IMAGES);
if (recording('onboarding')) { await startClip('welcome'); await page.waitForTimeout(500); }
await tap(page.getByRole('button', { name: T.letsGo }).or(page.getByRole('link', { name: T.letsGo })), 'letsGo');
await page.waitForURL(/\/onboarding/);
await page.waitForTimeout(1500);
if (recording('onboarding')) await rec.stop();
const deck = await page.locator('img').first().boundingBox();
const grab = { x: VIEW.width / 2, y: deck.y + deck.height * 0.55 };
if (recording('onboarding')) { await startClip('dna'); await page.waitForTimeout(400); }
for (const [i, a] of ANSWERS.entries()) {
  if (recording('onboarding') && i < 5) {
    // never film a card before its photo has decoded (a black card otherwise)
    await page.waitForFunction(() => [...document.querySelectorAll('img')].every((im) => im.complete && im.naturalWidth > 0), null, { timeout: 15000 }).catch(() => log('  (a deck photo did not load)'));
    await drag(grab, { x: grab.x + DRAG[a][0], y: grab.y + DRAG[a][1] });
    await page.waitForTimeout(520);
    if (i === 4) await rec.stop();
  } else {
    await page.getByRole('button', { name: GESTURE[a] }).first().click();
    await page.waitForTimeout(380);
  }
}
await page.waitForTimeout(1000);

// 2. "Ready? Check and go." (pre-filled: next long weekend, 1 person, home airport) → /trips with the persona card.
meta.flow.dates = (await page.getByText(/\d{1,2}[–-]\d{1,2}\s\p{L}+/u).first().innerText().catch(() => '')).trim();
if (recording('onboarding')) {
  await still('confirm', { showTrips: page.getByRole('button', { name: T.showTrips }) });
  await startClip('confirm');
  await page.waitForTimeout(700);
  await tap(page.getByRole('button', { name: T.showTrips }).or(page.getByRole('link', { name: T.showTrips })), 'showTrips');
  await page.waitForURL(/\/trips/);
  await page.waitForTimeout(4500);
  await rec.stop();
  meta.flow.persona = (await page.getByText(T.persona).first().innerText().catch(() => '')).trim();
  await still('trips_persona', { persona: page.getByText(T.persona).first() });
}
if (!recording('trips')) {
  await finish();
  process.exit(0);
}
if (!recording('onboarding')) {
  holdRecs = true; // the first ranking waits for Ola's budget below
  await page.getByRole('button', { name: T.showTrips }).or(page.getByRole('link', { name: T.showTrips })).first().click();
  await page.waitForURL(/\/trips/);
}

// 3. Ola's budget (deck persona: 1,800 PLN) goes into Profile's optional hard limit, then the ranked trips arrive.
holdRecs = true;
await page.goto(APP + '/profile', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
if (BUDGET) {
  await page.getByRole('switch', { name: rx('never show trips over', 'nie pokazuj wyjazdów') }).first().click();
  const budget = page.getByRole('slider', { name: rx('maximum price per person', 'maksymalna cena na osobę') }).first();
  await budget.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < (BUDGET - 600) / 100; i++) await page.keyboard.press('ArrowRight');
}
await page.waitForTimeout(800);
meta.flow.budget = BUDGET;
holdRecs = false;
allowFull = true;
await startClip('loading');
await page.waitForTimeout(300);
await tap(page.getByRole('link', { name: rx('^trips$', '^(podróże|wyjazdy)$') }), 'tripsTab');
await page.waitForURL(/\/trips/);
await waitReady(90000);
await page.waitForTimeout(800);
await rec.stop();
for (let i = 0; i < 4; i++) {
  await page.getByRole('button', { name: rx('^list$', '^lista$') }).first().click().catch(() => log('  (no List toggle)'));
  if (await page.locator('a[href^="/trips/"]').first().waitFor({ timeout: 8000 }).then(() => true, () => false)) break;
  log('  (list not shown yet, retrying)');
}
await page.waitForTimeout(1000);
if (!(await page.locator('a[href^="/trips/"]').count())) {
  await page.screenshot({ path: path.join(OUT, 'debug-trips.png') });
  throw new Error('no trip links on /trips (see debug-trips.png)');
}
const tripHrefs = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '').filter((h) => /^\/trips\/[A-Z]{3}-/.test(h)));
meta.flow.cities = await page.evaluate(() => [...document.querySelectorAll('h3')].map((e) => e.textContent.trim()).slice(0, 6));
const cardOf = (i) => page.locator('main li:has(article a[href^="/trips/"])').nth(i);
await still('trips_list', {
  dates: page.getByText(rx('for your dates', 'twoje daty|dla twoich dat')).first(),
  card1: cardOf(0), card2: cardOf(1), card3: cardOf(2),
  fit1: cardOf(0).getByText(rx('fit$', 'pasuje|dopasow')).first(),
  score1: cardOf(0).getByText(/^\d{2}$/).first(),
});
await page.evaluate(() => scrollTo(0, 0));

// 4. The swipe deck of ranked trips: "I want to go" on the #1, "Love it!" on the #2.
await page.getByRole('button', { name: rx('^swipe$', '^karty$|^przesuń') }).first().click().catch(() => log('  (no Swipe toggle)'));
await page.waitForTimeout(800);
await page.evaluate(() => scrollTo(0, 230));
await page.waitForTimeout(700);
const top = await page.locator('[data-offer-card], [aria-roledescription="card"], article').first().boundingBox().catch(() => null);
const offerGrab = top ? { x: VIEW.width / 2, y: top.y + Math.min(top.height, 844 - top.y) * 0.45 } : { x: 195, y: 560 };
await startClip('offers');
await page.waitForTimeout(700);
await drag(offerGrab, { x: offerGrab.x + 280, y: offerGrab.y - 30 }, 620);
await page.waitForTimeout(1300);
await drag(offerGrab, { x: offerGrab.x + 10, y: offerGrab.y - 380 }, 620);
await page.waitForTimeout(1600);
await rec.stop();

// 5. The #1 trip page: flight, stay, things to do; sources one tap away; evidence.
// the trip Ola loved (the #2 she swiped up on): the trip page beat follows her choice
const tripPath = tripHrefs[1] ?? tripHrefs[0];
meta.flow.trip = tripPath;
await page.goto(APP + tripPath, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await still('trip', {
  title: page.locator('h1').first(),
  score: page.getByText(/^\d{2}$/).first(),
  fit: page.getByText(rx('(good|great|strong|mixed) fit', 'pasuje|dopasowan')).first(),
  flight: page.getByText(rx('flight', 'lot')).first(),
  todo: page.getByText(rx('what to do', 'co robić|co zobaczyć')).first(),
  eat: page.getByText(rx('where to eat', 'gdzie zjeść')).first(),
  sources: page.getByRole('button', { name: T.sources }),
  evidence: page.getByText(T.evidence).first(),
});
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(500);
await startClip('sources');
await page.waitForTimeout(500);
await tap(page.getByRole('button', { name: T.sources }).or(page.getByText(T.sources)), 'sources');
await page.waitForTimeout(2200);
await rec.stop();
// the first source chip that appeared (viewport coords), for the highlight
meta.clips.sources.chip = await page.evaluate(() => {
  for (const el of document.querySelectorAll('span, a, div')) {
    const r = el.getBoundingClientRect();
    if (r.y < 250 || r.height > 32 || r.height < 12 || r.width < 120) continue;
    if (/·\s*\d{1,2}\s\p{L}{3}/u.test(el.textContent) && el.children.length <= 2) return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return null;
});
await still('trip_sources', { sourceChip: page.getByText(/·\s*\d{1,2}\s\w+/).first() });
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(400);
await startClip('evidence');
await page.waitForTimeout(400);
await page.evaluate(() => scrollBy({ top: 700, behavior: 'smooth' }));
await page.waitForTimeout(900);
await tap(page.getByText(T.evidence), 'evidence');
await page.waitForTimeout(2600);
await rec.stop();
// the first weather source chip inside Evidence (viewport coords), for the highlight
meta.clips.evidence.chip = await page.evaluate(() => {
  const els = [...document.querySelectorAll('span, a, div')].filter((el) => /^Open-Meteo\s*·/.test(el.textContent.trim()) && el.getBoundingClientRect().height < 32);
  const r = els[0]?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
});
await page.keyboard.press('Escape');

// 6. You book: approve the plan (nothing is booked by us), then My trips with a target price.
await page.goto(APP + tripPath + '/confirm', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await startClip('approve');
await page.waitForTimeout(500);
await tap(page.getByText(T.confirmSelf), 'confirmSelf');
await page.waitForTimeout(600);
await tap(page.getByRole('button', { name: T.approve }), 'approve');
await page.waitForTimeout(2600);
await rec.stop();
await still('approved', { links: page.getByRole('link', { name: /Google Flights/ }) });

await page.goto(APP + '/my-trips', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await startClip('mytrips');
await page.waitForTimeout(600);
await tap(page.getByRole('button', { name: T.setPrice }).or(page.getByText(T.setPrice)), 'setPrice');
await page.waitForTimeout(1200);
await rec.stop();
await still('mytrips', { trip: page.locator('li, article, a').filter({ hasText: /Nov|lis/ }).first() });

// 7. The returning home: your #1 and the next time off.
await page.goto(APP + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await still('home');

await finish();

async function finish() {
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  await ctx.close(); // writes the HAR
  await browser.close();
  fs.rmSync(FINAL + '.prev', { recursive: true, force: true });
  if (fs.existsSync(FINAL)) fs.renameSync(FINAL, FINAL + '.prev');
  fs.renameSync(OUT, FINAL);
  log(`done → footage/${LANG} [${PARTS.join(', ')}] (${RECORD ? 'recorded' : 'replayed'} api-${PART}.har)`, meta.flow);
}
