/**
 * Server-only (imported by app/api/[...path]/route.ts, never by client code): the browser talks to
 * same-origin `/api/*`; this forwards to the private backend (BACKEND_INTERNAL_URL) and adds
 * X-TripAI-Internal-Key from TRIPAI_INTERNAL_KEY. Neither env var is NEXT_PUBLIC, so neither the URL
 * nor the key is inlined into the client bundle. In dev, an unset BACKEND_INTERNAL_URL falls back to
 * NEXT_PUBLIC_API_URL or http://localhost:8000.
 */

export const INTERNAL_KEY_HEADER = "X-TripAI-Internal-Key";
const PREFIX = "/api";

/** Request headers the backend may see; everything else (incl. a client-sent internal key) is dropped. */
const FORWARD_REQUEST = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "user-agent",
  "x-tripai-session",
  "x-forwarded-for",
];

/** Hop-by-hop or rewritten by fetch (it decodes the body, so encoding/length no longer apply). */
const DROP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie", // re-added one by one below
]);

/** Per-path upstream timeouts (ms): /recommendations computes live fits, /scan/run a whole scan. */
const TIMEOUTS: [prefix: string, ms: number][] = [
  ["/recommendations", 60_000],
  ["/scan", 95_000],
  ["/interview", 50_000],
];
const DEFAULT_TIMEOUT = 30_000;

export function timeoutFor(path: string): number {
  return TIMEOUTS.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? DEFAULT_TIMEOUT;
}

export type Env = Record<string, string | undefined>;

export function backendUrl(env: Env = process.env): string | null {
  const url = env.BACKEND_INTERNAL_URL || (env.NODE_ENV !== "production" ? env.NEXT_PUBLIC_API_URL || "http://localhost:8000" : "");
  return url ? url.replace(/\/$/, "") : null;
}

const problem = (status: number, detail: string) => Response.json({ detail }, { status, headers: { "cache-control": "no-store" } });

export async function proxy(req: Request, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") {
    // same-origin: no CORS preflight reaches us in practice; answer locally, never hit the backend
    return new Response(null, { status: 204, headers: { allow: "GET, POST, PUT, DELETE, OPTIONS" } });
  }
  const base = backendUrl(env);
  if (!base) return problem(503, "backend not configured");

  const incoming = new URL(req.url);
  const path = incoming.pathname.startsWith(PREFIX) ? incoming.pathname.slice(PREFIX.length) || "/" : incoming.pathname;
  const target = `${base}${path}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  // the backend sets the session cookie's Secure/SameSite from the original scheme
  headers.set("x-forwarded-proto", req.headers.get("x-forwarded-proto") ?? incoming.protocol.replace(":", ""));
  if (env.TRIPAI_INTERNAL_KEY) headers.set(INTERNAL_KEY_HEADER, env.TRIPAI_INTERNAL_KEY);

  const timeout = AbortSignal.timeout(timeoutFor(path));
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;
  let res: Response;
  try {
    res = await fetchImpl(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // streaming request body (Node fetch requires half-duplex for a ReadableStream)
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([req.signal, timeout]),
    } as RequestInit);
  } catch (err) {
    if (timeout.aborted) return problem(504, "backend timed out");
    if (req.signal.aborted) return problem(499, "client closed request");
    console.error("[tripai proxy] backend unreachable:", err instanceof Error ? err.message : err);
    return problem(502, "backend unreachable");
  }

  const out = new Headers();
  res.headers.forEach((v, k) => {
    if (!DROP_RESPONSE.has(k.toLowerCase())) out.set(k, v);
  });
  for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
  out.delete(INTERNAL_KEY_HEADER);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
