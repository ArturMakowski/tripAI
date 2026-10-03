import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendations } from "./mock/api";
import { DEMO_PROFILE } from "./mock/fixtures";
import { weightsFromSlider } from "./scoring";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("mock two-phase /recommendations", () => {
  it("fast returns cached estimates, full exact prices, and the order changes", async () => {
    const req = { profile: DEMO_PROFILE, weights: weightsFromSlider(50) };
    const [fast, full] = await Promise.all([recommendations(req, "fast"), recommendations(req, "full")]);
    expect(fast.map((r) => r.id).sort()).toEqual(full.map((r) => r.id).sort());
    const rome = (xs: typeof fast) => xs.find((r) => r.city === "Rome")!;
    expect(rome(fast).total_cost_pln).not.toBe(rome(full).total_cost_pln);
    expect(rome(fast).evidence.find((e) => e.kind === "flight")!.source).toContain("calendar");
    expect(fast.map((r) => r.id)).not.toEqual(full.map((r) => r.id));
  });
});

describe("two-phase loading is gated on backend support", () => {
  async function liveApi(health: unknown, recStatus = 200) {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.endsWith("/health")) {
          if (health === "down") throw new TypeError("network");
          return new Response(JSON.stringify(health), { status: 200 });
        }
        return new Response("[]", { status: recStatus });
      }),
    );
    const { api } = await import("./api");
    return { api, urls };
  }

  it("today's backend (no /health.phases) -> no phases: the classic single call is used", async () => {
    const { api } = await liveApi({ ok: true, provider: "LiveProvider" });
    expect(await api.capabilities()).toEqual({ phases: false });
  });

  it("unreachable /health -> no phases", async () => {
    const { api } = await liveApi("down");
    expect(await api.capabilities()).toEqual({ phases: false });
  });

  it("phases advertised -> phase URLs; capability asked once", async () => {
    const { api, urls } = await liveApi({ ok: true, phases: ["fast", "full"] });
    expect(await api.capabilities()).toEqual({ phases: true });
    await api.capabilities();
    const r = await api.recommendationsPhase({ profile: DEMO_PROFILE }, "fast");
    expect(r.mode).toBe("live");
    expect(urls.filter((u) => u.endsWith("/health"))).toHaveLength(1);
    expect(urls.at(-1)).toBe("http://backend.test/recommendations?phase=fast");
  });

  it("a failing live phase call throws (never a fixture 'fast' result posing as live)", async () => {
    const { api } = await liveApi({ ok: true, phases: ["fast", "full"] }, 503);
    await expect(api.recommendationsPhase({ profile: DEMO_PROFILE }, "fast")).rejects.toThrow(/503/);
  });
});
