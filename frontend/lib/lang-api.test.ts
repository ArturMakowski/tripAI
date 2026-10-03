import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function live() {
  vi.stubEnv("NEXT_PUBLIC_MOCK", "0");
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

describe("language switch invalidates cached recommendations", () => {
  it("cached recs are fresh only for the same profile and language", async () => {
    const { isFresh } = await import("./use-recommendations");
    const meta = { at: 1_000, profileKey: "p", lang: "en" as const };
    expect(isFresh(meta, { profileKey: "p", lang: "en", now: 2_000 })).toBe(true);
    expect(isFresh(meta, { profileKey: "p", lang: "pl", now: 2_000 })).toBe(false); // switched to PL: refetch
    expect(isFresh({ at: 1_000, profileKey: "p" }, { profileKey: "p", lang: "en", now: 2_000 })).toBe(false); // pre-i18n cache
    expect(isFresh(meta, { profileKey: "q", lang: "en", now: 2_000 })).toBe(false);
    expect(isFresh(meta, { profileKey: "p", lang: "en", now: 1_000 + 31 * 60_000 })).toBe(false);
  });

  it("setRecs records the language the request went out in", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    const { setApiLang } = await import("./api");
    const { useTrip } = await import("./store");
    setApiLang("pl");
    useTrip.getState().setRecs([], { profile: null, weights: { price: 1, weather: 1, crowds: 1, taste: 1 }, mode: "fixture" });
    expect(useTrip.getState().recsMeta?.lang).toBe("pl");
  });
});
