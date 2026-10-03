import { describe, expect, it, vi } from "vitest";
import { backendUrl, INTERNAL_KEY_HEADER, proxy, timeoutFor } from "./proxy";

const ENV = { NODE_ENV: "production", BACKEND_INTERNAL_URL: "http://backend.internal:8080/", TRIPAI_INTERNAL_KEY: "k3y" };

function upstream(make: () => Response = () => new Response("{}", { status: 200 })) {
  const calls: { url: string; init: RequestInit & { duplex?: string } }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return make();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("/api proxy", () => {
  it("injects the internal key, forwards path + query + session/cookie/language, drops a client-sent key", async () => {
    const { calls, fetchImpl } = upstream();
    const req = new Request("https://app.example/api/windows/long-weekends?from=2026-11-01&to=2026-12-01", {
      headers: {
        "X-TripAI-Session": "s_abc.sig",
        cookie: "tripai_session=s_abc.sig",
        "accept-language": "pl-PL,pl;q=0.9",
        [INTERNAL_KEY_HEADER]: "forged",
        authorization: "Bearer nope",
      },
    });
    await proxy(req, ENV, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://backend.internal:8080/windows/long-weekends?from=2026-11-01&to=2026-12-01");
    const h = new Headers(calls[0].init.headers);
    expect(h.get(INTERNAL_KEY_HEADER)).toBe("k3y");
    expect(h.get("x-tripai-session")).toBe("s_abc.sig");
    expect(h.get("cookie")).toBe("tripai_session=s_abc.sig");
    expect(h.get("accept-language")).toBe("pl-PL,pl;q=0.9");
    expect(h.get("x-forwarded-proto")).toBe("https");
    expect(h.get("authorization")).toBeNull();
    expect(calls[0].init.body).toBeUndefined();
  });

  it("streams POST bodies and returns status, X-TripAI-Session and every Set-Cookie", async () => {
    const res = new Response('{"ok":1}', { status: 201, headers: { "content-type": "application/json", "X-TripAI-Session": "s_new.sig" } });
    res.headers.append("set-cookie", "a=1; Path=/; HttpOnly");
    res.headers.append("set-cookie", "b=2; Path=/");
    const { calls, fetchImpl } = upstream(() => res);
    const out = await proxy(
      new Request("http://localhost:3000/api/recommendations?phase=fast", { method: "POST", body: '{"x":1}', headers: { "content-type": "application/json" } }),
      ENV,
      fetchImpl,
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.duplex).toBe("half");
    expect(await new Response(calls[0].init.body).text()).toBe('{"x":1}');
    expect(out.status).toBe(201);
    expect(out.headers.get("X-TripAI-Session")).toBe("s_new.sig");
    expect(out.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
    expect(await out.json()).toEqual({ ok: 1 });
  });

  it("passes backend errors through and maps network failures/timeouts to 502/504", async () => {
    const err = await proxy(new Request("http://x/api/cities"), ENV, upstream(() => new Response("no", { status: 401 })).fetchImpl);
    expect(err.status).toBe(401);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await proxy(new Request("http://x/api/cities"), ENV, down)).status).toBe(502);
  });

  it("answers OPTIONS locally", async () => {
    const { calls, fetchImpl } = upstream();
    const out = await proxy(new Request("http://x/api/recommendations", { method: "OPTIONS" }), ENV, fetchImpl);
    expect(out.status).toBe(204);
    expect(calls).toHaveLength(0);
  });

  it("targets BACKEND_INTERNAL_URL; dev falls back to localhost:8000; prod without it is 503", async () => {
    expect(backendUrl(ENV)).toBe("http://backend.internal:8080");
    expect(backendUrl({ NODE_ENV: "development" })).toBe("http://localhost:8000");
    expect(backendUrl({ NODE_ENV: "development", NEXT_PUBLIC_API_URL: "http://127.0.0.1:9000" })).toBe("http://127.0.0.1:9000");
    expect(backendUrl({ NODE_ENV: "production" })).toBeNull();
    const out = await proxy(new Request("http://x/api/cities"), { NODE_ENV: "production" }, upstream().fetchImpl);
    expect(out.status).toBe(503);
  });

  it("no key configured (local dev): no internal key header is sent", async () => {
    const { calls, fetchImpl } = upstream();
    await proxy(new Request("http://x/api/health"), { NODE_ENV: "development" }, fetchImpl);
    expect(new Headers(calls[0].init.headers).has(INTERNAL_KEY_HEADER)).toBe(false);
    expect(calls[0].url).toBe("http://localhost:8000/health");
  });

  it("gives /recommendations 60 s, scans longer, everything else 30 s", () => {
    expect(timeoutFor("/recommendations")).toBe(60_000);
    expect(timeoutFor("/scan/run")).toBe(95_000);
    expect(timeoutFor("/cities")).toBe(30_000);
    expect(timeoutFor("/recommendationsX")).toBe(30_000);
  });
});
