import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function live() {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test");
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith("/interview") ? { reply: "ok", profile: null } : {}), { status: 200 });
    }),
  );
  const apiMod = await import("./api");
  return { ...apiMod, calls };
}

describe("UI language travels with AI requests", () => {
  it("/interview gets lang in the body and Accept-Language", async () => {
    const { api, setApiLang, calls } = await live();
    setApiLang("pl");
    await api.interview([{ role: "user", content: "jedzenie" }]);
    const c = calls.find((x) => x.url.endsWith("/interview"))!;
    expect(JSON.parse(String(c.init.body)).lang).toBe("pl");
    expect(new Headers(c.init.headers).get("accept-language")).toMatch(/^pl/);
  });

  it("notification prefs carry lang too", async () => {
    const { setApiLang } = await live();
    const { notifyApi } = await import("./notify");
    setApiLang("pl");
    const { calls } = { calls: (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls };
    await notifyApi.savePrefs({ enabled: true } as never);
    const put = calls.find(([u, i]) => u.endsWith("/notifications/prefs") && i?.method === "PUT")!;
    expect(JSON.parse(String(put[1].body)).lang).toBe("pl");
    expect(new Headers(put[1].headers).get("accept-language")).toMatch(/^pl/);
  });
});
