// Renders scene.html frame by frame (deterministic seek(t)) and encodes with ffmpeg.
//   node render.mjs --lang en --stills            five gate stills → ../out/stills/<lang>-*.png
//   node render.mjs --lang en --at 12.5,30         ad-hoc stills
//   node render.mjs --lang en --fps 10             animatic (silent) → ../out/tripai-video-<lang>-animatic.mp4
//   node render.mjs --lang en [--scale 2]          full 30 fps, 1080p (4K with --scale 2) → frames/<lang>-<h>/
// Audio is muxed separately by audio.mjs.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '../out');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const LANG = opt('lang', 'en');
const SCALE = Number(opt('scale', 1));
const FPS = Number(opt('fps', 30));
const WORKERS = Number(opt('workers', Math.max(2, Math.min(6, os.cpus().length - 2))));
const STILLS = { opening: 1.5, composition: 11.4, product: 39.2, transition: 41.12, end: 63.0 };

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(HERE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(HERE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const URL0 = `http://127.0.0.1:${server.address().port}/scene.html?lang=${LANG}`;

const browser = await chromium.launch();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(URL0);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 60000 });
  return page;
}
async function shot(page, t, file) {
  await page.evaluate((t) => window.seek(t), t);
  await page.screenshot({ path: file, type: file.endsWith('.jpg') ? 'jpeg' : 'png', quality: file.endsWith('.jpg') ? 95 : undefined });
}

if (args.includes('--sfx')) {
  const page = await openPage();
  const ev = await page.evaluate(() => ({ duration: window.DURATION, events: window.SFX }));
  const f = path.join(HERE, 'audio', `sfx-${LANG}.json`);
  fs.writeFileSync(f, JSON.stringify(ev, null, 1));
  console.log(f, ev.events.length, 'events');
} else if (args.includes('--stills') || opt('at')) {
  const dir = path.join(OUTDIR, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const page = await openPage();
  const list = opt('at') ? Object.fromEntries(opt('at').split(',').map((t) => [`t${t}`, Number(t)])) : STILLS;
  for (const [name, t] of Object.entries(list)) {
    const f = path.join(dir, `${LANG}-${name}.png`);
    await shot(page, t, f);
    console.log(f);
  }
} else {
  const page0 = await openPage();
  const dur = await page0.evaluate(() => window.DURATION);
  await page0.close();
  const n = Math.round(dur * FPS);
  const h = 1080 * SCALE;
  const dir = path.join(HERE, 'frames', `${LANG}-${h}-${FPS}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const page = await openPage();
    for (let i = w; i < n; i += WORKERS) {
      await shot(page, i / FPS, path.join(dir, `${String(i).padStart(5, '0')}.jpg`));
      if (++done % 150 === 0) console.log(`${done}/${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  const name = FPS < 30 ? `tripai-video-${LANG}-animatic.mp4` : `tripai-video-${LANG}-${h}p-silent.mp4`;
  const out = path.join(FPS < 30 ? OUTDIR : dir, '..', FPS < 30 ? '' : '', name);
  const target = FPS < 30 ? path.join(OUTDIR, name) : path.join(HERE, 'frames', name);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', SCALE > 1 ? '16' : '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target]);
  console.log('wrote', target, `(${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  void out;
}
await browser.close();
server.close();
