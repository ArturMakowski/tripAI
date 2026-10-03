/**
 * Shared test plumbing for the TripAI suite.
 *
 * - `guard()` keeps tests off the paid data path: every POST /recommendations that is not already
 *   `phase=fast` is re-sent as `phase=fast` (cache + Travelpayouts + seed only, no SerpApi), so a
 *   test never triggers a new SerpApi search. Tests tagged `live` skip it on purpose.
 * - It also injects a tiny error recorder into every HTML document of the app, because the e2e
 *   framework has no console/pageerror hook yet: console.error, uncaught errors (React hydration
 *   errors in production land here via reportError) and unhandled rejections.
 * - It marks the first-run tutorial as already seen (intro + every coach-mark tour), so its overlay
 *   never sits on top of the flow under test. Pass `{ tutorial: true }` to test the tutorial itself.
 */
import type { Browser, WebRoute } from '@e2e-dev/web';

export interface PageError {
  kind: string;
  message: string;
  path: string;
}

const RECORDER = `<script>(function(){
  if (window.__e2eErrors) return;
  var list = (window.__e2eErrors = []);
  function push(kind, msg){ try { list.push({ kind: kind, message: String(msg).slice(0, 600), path: location.pathname + location.search }); } catch (e) {} }
  var orig = console.error;
  console.error = function(){
    push('console.error', Array.prototype.map.call(arguments, function(a){ return a && a.stack ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : a); }).join(' '));
    return orig.apply(this, arguments);
  };
  addEventListener('error', function(e){
    if (e.target && e.target !== window && (e.target.src || e.target.href)) return push('resource', e.target.src || e.target.href);
    push('error', (e.error && e.error.stack) || e.message);
  }, true);
  addEventListener('unhandledrejection', function(e){ push('unhandledrejection', (e.reason && e.reason.stack) || e.reason); });
})();</script>`;

/** Runs before the app: the tutorial counts as seen unless the page already stored its own flags. */
const SEEN_TUTORIAL = `<script>(function(){
  try {
    if (!localStorage.getItem('tripai-tutorial-v1'))
      localStorage.setItem('tripai-tutorial-v1', JSON.stringify({ intro: true, tours: { trips: true, receipt: true, windows: true, inbox: true } }));
  } catch (e) {}
})();</script>`;

const HOP_BY_HOP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

function plainHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k)) out[k] = v;
  });
  return out;
}

function forwardHeaders(route: WebRoute): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.request.headers)) {
    if (k !== 'host' && k !== 'content-length' && !k.startsWith(':')) out[k] = v;
  }
  return out;
}

export interface Guard {
  /** How many full-pipeline /recommendations calls were downgraded to phase=fast. */
  downgraded(): number;
  /** Errors recorded in the current document (resets on a full page load); null if the recorder is missing. */
  errors(): Promise<PageError[] | null>;
}

export async function guard(
  browser: Browser,
  baseUrl: string | undefined,
  opts: { live?: boolean; tutorial?: boolean } = {},
): Promise<Guard> {
  const inject = RECORDER + (opts.tutorial ? '' : SEEN_TUTORIAL);
  let downgraded = 0;

  if (!opts.live) {
    await browser.route(/\/recommendations(\?|$)/, async (route) => {
      const url = new URL(route.request.url);
      if (route.request.method !== 'POST' || url.searchParams.get('phase') === 'fast') return route.continue();
      url.searchParams.set('phase', 'fast');
      downgraded++;
      const res = await fetch(url, { method: 'POST', headers: forwardHeaders(route), body: route.request.postData });
      await route.fulfill({ status: res.status, headers: plainHeaders(res.headers), body: await res.text() });
    });
  }

  if (baseUrl) {
    const origin = new URL(baseUrl).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Page URLs only: no file extension in the path (skips /_next/*, images, sw.js, manifest).
    await browser.route(new RegExp(`^${origin}(/[^.?#]*)?([?#].*)?$`), async (route) => {
      const h = route.request.headers;
      const isDocument = route.request.method === 'GET' && !h['rsc'] && !h['next-router-prefetch'] && (h['accept'] ?? '').includes('text/html');
      if (!isDocument) return route.continue();
      const res = await fetch(route.request.url, { headers: forwardHeaders(route) });
      let body = await res.text();
      if ((res.headers.get('content-type') ?? '').includes('text/html')) body = body.replace(/<head[^>]*>/i, (m) => m + inject);
      await route.fulfill({ status: res.status, headers: plainHeaders(res.headers), body });
    });
  }

  return {
    downgraded: () => downgraded,
    errors: async () =>
      (await browser.evaluate(() => ((window as unknown as { __e2eErrors?: PageError[] }).__e2eErrors ?? null) as never)) as PageError[] | null,
  };
}

/**
 * Errors that count as app bugs. A failed third-party image (Wikimedia, Unsplash) is reported by the
 * photo fallback, not a crash; a failed asset of the app itself (same origin) is a bug.
 */
export function realErrors(errors: PageError[], baseUrl: string | undefined): PageError[] {
  const origin = baseUrl ? new URL(baseUrl).origin : '';
  return errors.filter((e) => e.kind !== 'resource' || (!!origin && e.message.startsWith(origin)));
}

/** "1,096 PLN" / "1 096 zł" -> 1096 */
export function pln(text: string): number | null {
  const m = text.match(/(\d[\d\s.,  ]*)\s*(PLN|zł)/i);
  if (!m) return null;
  return Number(m[1].replace(/[^\d]/g, ''));
}
