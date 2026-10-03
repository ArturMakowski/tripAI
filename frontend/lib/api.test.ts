import { afterEach, describe, expect, it, vi } from "vitest";
import { api, HttpError, SESSION_HEADER } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(responses: { token?: string; status?: number }[]) {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      const r = responses[Math.min(calls.length - 1, responses.length - 1)];
      return new Response(JSON.stringify({ ok: true }), {
        status: r.status ?? 200,
        headers: r.token ? { [SESSION_HEADER]: r.token } : {},
      });
    }),
  );
  return calls;
}

const sent = (init: RequestInit) => new Headers(init.headers).get(SESSION_HEADER);

describe("X-TripAI-Session", () => {
  it("stores the server-issued token and sends it back on every later call", async () => {
    const calls = stubFetch([{ token: "s_abc.sig" }, {}, { token: "s_new.sig" }, {}]);
    await api.health();
    await api.health();
    await api.health(); // server rotated the session
    await api.health();
    expect(calls.map(sent)).toEqual([null, "s_abc.sig", "s_abc.sig", "s_new.sig"]);
  });

  it("surfaces HTTP status for contract errors", async () => {
    stubFetch([{ status: 422 }]);
    await expect(api.health()).rejects.toBeInstanceOf(HttpError);
    await expect(api.health()).rejects.toMatchObject({ status: 422 });
  });
});
