// Records every piece of real footage the video uses from the LIVE Railway app, in one command:
//   E2E_PROD_URL=<frontend-url> NEXT_PUBLIC_API_URL=<backend-url> node capture.mjs --lang en|pl [--record]
// Backend calls are recorded once per section to footage/<lang>/api-<section>.har (--record) and replayed on every later take, so the
// footage is deterministic and re-takes never reach the backend again (no SerpApi spend). Without a HAR,
// --record is implied. Outputs footage/<lang>/: clip frame sequences (30 fps, 1170 px wide), full-page
// stills with their sticky header/nav cropped out as overlays, and meta.json with element boxes for the cursor.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en';
const OUT = path.resolve('footage', LANG);
const FORCE_RECORD = args.includes('--record');
// Deployment URLs come from env (the repo is public): E2E_PROD_URL = frontend, NEXT_PUBLIC_API_URL = backend.
const APP = process.env.E2E_PROD_URL?.replace(/\/$/, '');
const API_HOST = process.env.NEXT_PUBLIC_API_URL && new URL(process.env.NEXT_PUBLIC_API_URL).host;
if (!APP || !API_HOST) throw new Error('set E2E_PROD_URL=<frontend-url> and NEXT_PUBLIC_API_URL=<backend-url>');
const API = new RegExp(API_HOST.replace(/\./g, '\\.'));
const FPS = 30;
const DPR = 3;

// Visible strings used as locators (the app follows the browser locale).
const T = {
  en: { skip: 'Skip and use the demo profile', why: 'Why this, why now', ready: /Ranking updated|Live prices in/,
        radar: 'Długi weekend radar', fitsYou: /why it fits you/i, flip: /what would flip it/i, hash: /inputs hash/i,
        evidence: /^evidence$/i, aiCheck: /AI check/, matters: /What matters most/, fit: /^(Good|Strong|Great|Mixed) fit$/,
        swiped: /you swiped/, receipt: /^receipt$/i },
  pl: { skip: /demo/i, why: /Dlaczego to/i, ready: /Ranking zaktualizowany|Ceny na żywo|Ranking updated/,
        radar: 'Długi weekend radar', fitsYou: /dlaczego do ciebie pasuje|why it fits you/i,
        flip: /co by to zmieniło|what would flip it/i, hash: /hash/i, evidence: /^(dowody|evidence)$/i, aiCheck: /AI/,
        matters: /Co jest|What matters/, fit: /pasuje|fit$/i, swiped: /przesun|swiped/i, receipt: /^(paragon|rachunek|receipt)$/i },
}[LANG];

fs.mkdirSync(OUT, { recursive: true });
const meta = { lang: LANG, captured_at: new Date().toISOString(), dpr: DPR, fps: FPS, clips: {}, stills: {} };
const browser = await chromium.launch({ args: [`--force-device-scale-factor=${DPR}`] }); // screencast at device pixels

async function newPage(section) {
  const HAR = path.join(OUT, `api-${section}.har`);
  const RECORD = FORCE_RECORD || !fs.existsSync(HAR);
  log(`[${section}] ${RECORD ? 'recording' : 'replaying'} ${path.basename(HAR)}`);
  // 390x844: the full iPhone 14 screen, as the installed PWA (no browser chrome)
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, locale: LANG === 'pl' ? 'pl-PL' : 'en-GB', reducedMotion: 'no-preference' });
  await ctx.routeFromHAR(HAR, { url: API, update: RECORD, updateContent: 'embed', notFound: 'fallback' });
  // Spend guard: at most one fast+full /recommendations pair per context ever reaches the backend.
  let recs = 0;
  await ctx.route(/\/recommendations/, (route) => {
    recs += 1;
    log(`  /recommendations #${recs}`, route.request().url().split('?')[1] ?? '');
    return recs > 2 ? route.abort() : route.fallback();
  });
  const page = await ctx.newPage();
  page.on('request', (r) => { if (API.test(r.url()) && !RECORD) log('  api', r.method(), r.url().replace(/^https:\/\/[^/]+/, '')); });
  return { ctx, page };
}
const log = (...a) => console.log(...a);

/** Start a CDP screencast; returns stop() → writes a constant-fps sequence plus a time-stamped event log. */
async function screencast(ctx, page, name) {
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const events = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ t: f.metadata.timestamp, d: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 390 * DPR, maxHeight: 2000 * DPR });
  const t0 = Date.now() / 1000;
  return {
    mark: (ev) => events.push({ t: +(Date.now() / 1000 - t0).toFixed(3), ...ev }),
    async stop() {
      await page.waitForTimeout(300);
      await cdp.send('Page.stopScreencast');
      const dir = path.join(OUT, name);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const end = Date.now() / 1000;
      const n = Math.floor((end - t0) * FPS);
      let j = 0;
      for (let k = 0; k < n; k++) {
        const t = t0 + k / FPS;
        while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
        fs.writeFileSync(path.join(dir, `${String(k).padStart(4, '0')}.jpg`), Buffer.from(frames[j].d, 'base64'));
      }
      meta.clips[name] = { frames: n, w: 390, h: 844, events };
      log(`clip ${name}: ${frames.length} raw → ${n} frames`);
    },
  };
}

/** Eased pointer drag so the app's own drag physics play; logs pointer positions for the composited cursor. */
async function drag(page, rec, from, to, ms = 600, holdMs = 120) {
  rec.mark({ type: 'down', x: from.x, y: from.y });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) {
    const e = 1 - Math.pow(1 - i / steps, 3);
    const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e;
    await page.mouse.move(x, y);
    rec.mark({ type: 'move', x: +x.toFixed(1), y: +y.toFixed(1) });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  rec.mark({ type: 'up', x: to.x, y: to.y });
}

/** Box of the first match in page (document) coordinates, CSS px. */
async function box(page, locator) {
  const l = locator.first();
  if (!(await l.count())) return null;
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  });
}

/** Full-page still without sticky chrome, plus the header/nav as separate overlays (they stay put while we pan). */
async function still(page, name, targets) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  const chrome = {};
  for (const sel of ['header', 'nav']) {
    const r = await page.locator(sel).first().boundingBox().catch(() => null);
    if (!r) continue;
    const vr = await page.locator(sel).first().evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    await page.screenshot({ path: path.join(OUT, `${name}.${sel}.png`), clip: { x: vr.x, y: vr.y, width: vr.w, height: vr.h } });
    chrome[sel] = vr;
  }
  const boxes = {};
  for (const [k, loc] of Object.entries(targets)) boxes[k] = await box(page, loc(page));
  const tag = await page.addStyleTag({ content: 'header,nav{visibility:hidden!important}' });
  const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await tag.evaluate((el) => el.remove());
  meta.stills[name] = { ...size, chrome, boxes };
  log(`still ${name}: ${size.w}x${size.h}`, Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, !!v])));
}

/** Hide the in-app push toast (the video rebuilds the notification itself, without prices). */
async function hideToast(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('button[aria-label]')) {
      if (/dismiss|close|zamknij/i.test(el.getAttribute('aria-label'))) {
        const card = el.closest('[role="status"],[role="alert"],section,div.fixed,div[class*="fixed"],div[class*="absolute"]');
        if (card) card.setAttribute('data-pitch-hide', '');
      }
    }
  });
  await page.addStyleTag({ content: '[data-pitch-hide]{display:none!important}' });
}

async function openTrips(page) {
  await page.goto(APP + '/', { waitUntil: 'networkidle' });
  await page.getByText(T.skip).first().click();
  await page.waitForTimeout(800);
  await page.goto(APP + '/trips', { waitUntil: 'networkidle' });
  await page.getByText(T.ready).first().waitFor({ timeout: 120000 }).catch(() => log('  (no ready text)'));
  await page.waitForTimeout(2500);
}

// ---------------------------------------------------------------- 1. Travel DNA swipe deck (live drags)
{
  const { ctx, page } = await newPage('dna');
  await page.goto(APP + '/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const card = await page.locator('img').first().boundingBox();
  const c = { x: 195, y: card ? card.y + card.height * 0.55 : 400 };
  const rec = await screencast(ctx, page, 'dna');
  await page.waitForTimeout(500);
  for (const [dx, dy] of [[260, 30], [20, -330], [260, -20], [-260, 30]]) {
    await drag(page, rec, c, { x: c.x + dx, y: c.y + dy }, 420);
    await page.waitForTimeout(650);
  }
  await rec.stop();
  await ctx.close();
}

// ---------------------------------------------------------------- 2. Trips list still + 3. receipt + slider clip
const order = (page) => page.evaluate(() => [...document.querySelectorAll('h3')].map((e) => e.textContent.trim()));
{
  const { ctx, page } = await newPage('trips');
  await openTrips(page);
  await hideToast(page);
  meta.order_default = await order(page);
  const cardBox = (i) => (p) => p.locator('h3').nth(i).locator('xpath=ancestor::*[contains(@class,"rounded")][1]');
  await still(page, 'trips', {
    slider: (p) => p.getByRole('slider'),
    sliderCard: (p) => p.getByText(T.matters).locator('xpath=ancestor::*[contains(@class,"rounded")][1]'),
    fit1: (p) => p.getByText(T.fit),
    card1: cardBox(0), card2: cardBox(1), card3: cardBox(2),
    why1: (p) => p.getByText(T.why),
    budget: (p) => p.getByText(/Budget|Budżet/),
  });

  await page.evaluate(() => scrollTo(0, 0));
  await page.getByText(T.why).first().click();
  await page.waitForURL(/\/trips\/.+/);
  await page.waitForTimeout(3000);
  meta.receipt_path = new URL(page.url()).pathname;
  await still(page, 'receipt', {
    title: (p) => p.locator('h1').first(),
    aiCheck: (p) => p.getByText(T.aiCheck),
    fitsYou: (p) => p.getByText(T.fitsYou),
    swiped: (p) => p.getByText(T.swiped),
    receipt: (p) => p.getByText(T.receipt, { exact: true }),
    source1: (p) => p.getByText(/Open-Meteo ·/),
    evidence: (p) => p.getByText(T.evidence),
    flip: (p) => p.getByText(T.flip),
    hash: (p) => p.getByText(T.hash),
    hashValue: (p) => p.getByText(/sha256/),
  });
  meta.receipt_text = (await page.innerText('body')).split('\n').filter(Boolean).slice(0, 60);

  // slider clip, last, because the slider position persists
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await hideToast(page);
  const slider = page.getByRole('slider').first();
  await page.evaluate((re) => {
    const h = [...document.querySelectorAll('p,h2,div')].find((e) => new RegExp(re, 'i').test(e.textContent) && e.children.length === 0);
    const card = h?.closest('[class*="rounded"]') ?? document.querySelector('[role="slider"]');
    scrollTo(0, card.getBoundingClientRect().top + scrollY - 64);
  }, T.matters.source);
  await page.waitForTimeout(800);
  const sb = await slider.boundingBox();
  const track = await slider.evaluate((el) => {
    let t = el.parentElement;
    while (t && t.getBoundingClientRect().width < 200) t = t.parentElement;
    const r = t.getBoundingClientRect();
    return { x: r.x, w: r.width };
  });
  const cy = sb.y + sb.height / 2;
  const rec = await screencast(ctx, page, 'slider');
  await page.waitForTimeout(400);
  await drag(page, rec, { x: sb.x + sb.width / 2, y: cy }, { x: track.x + 4, y: cy }, 900);
  await page.waitForTimeout(1400);
  meta.order_price = await order(page);
  await drag(page, rec, { x: track.x + 4, y: cy }, { x: track.x + track.w - 4, y: cy }, 1100);
  await page.waitForTimeout(1400);
  meta.order_experience = await order(page);
  await rec.stop();
  meta.clips.slider.thumb = { w: sb.width, h: sb.height };
  await ctx.close();
}

// ---------------------------------------------------------------- 4. Free time: long-weekend radar still
{
  const { ctx, page } = await newPage('windows');
  await page.goto(APP + '/', { waitUntil: 'networkidle' });
  await page.getByText(T.skip).first().click();
  await page.waitForTimeout(800);
  await page.goto(APP + '/windows', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await still(page, 'windows', {
    calendar: (p) => p.getByRole('grid').first(),
    radar: (p) => p.getByText(T.radar),
    bridge1: (p) => p.getByText(/→ \d+ (days|dni)/).first(),
    bridgeCard1: (p) => p.locator('li, article').filter({ hasText: /→ \d+ (days|dni)/ }).first(),
  });
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
await browser.close();
log('done →', OUT);
