// T19: one pre-filled confirm after the deck: dates, party, airports, each editable in place, one "Pokaż wyjazdy".
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
});
const lang = vi.hoisted(() => ({ current: "pl" as "pl" | "en" }));
vi.mock("@/lib/i18n", async (orig) => {
  const m = await orig<typeof import("@/lib/i18n")>();
  return { ...m, useT: () => ({ t: m.MESSAGES[lang.current], fmt: m.fmtFor(lang.current), lang: lang.current }) };
});
// the picked/pre-filled dates (server rendering can't read the persisted dates store)
const ranges = vi.hoisted(() => ({ current: [] as { start: string; end: string; quick?: "long" }[] }));
vi.mock("@/lib/windows-store", async (orig) => ({ ...(await orig<typeof import("@/lib/windows-store")>()), useUsableRanges: () => ranges.current }));
import { renderToStaticMarkup } from "react-dom/server";
import { TripConfirm } from "@/components/trip-confirm";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const render = (busy = false) =>
  renderToStaticMarkup(
    <TripConfirm party={1} onParty={() => {}} airports={["KRK"]} onAirports={() => {}} busy={busy} onBack={() => {}} onConfirm={() => {}} />,
  );

describe("TripConfirm", () => {
  beforeEach(() => {
    lang.current = "pl";
    ranges.current = [{ start: "2026-11-11", end: "2026-11-15", quick: "long" }];
  });

  it("shows the pre-filled long weekend, 1 person and the default airport, with one primary button", () => {
    const t = text(render());
    expect(t).toContain("Kiedy 11–15 lis Najbliższy długi weekend");
    expect(t).toContain("Kto 1 osoba");
    expect(t).toMatch(/Skąd Krak[oó]w/);
    expect(t).toContain("Pokaż wyjazdy");
    expect(t).not.toContain("Pokaż moje DNA");
  });

  it("keeps every value editable in place (editors closed until asked)", () => {
    const html = render();
    expect(html.match(/aria-expanded="false"/g)?.length).toBe(2); // dates, airports
    expect(html).toContain('aria-label="O jedną osobę więcej"');
  });

  it("dates the user picked themselves are shown as they are", () => {
    ranges.current = [{ start: "2027-01-14", end: "2027-01-19" }];
    expect(text(render())).toContain("Kiedy 14–19 sty Zmień");
  });

  it("English, and a busy state while the profile is computed", () => {
    lang.current = "en";
    const t = text(render());
    expect(t).toContain("When 11–15 Nov Next long weekend");
    expect(t).toContain("Show trips");
    expect(text(render(true))).toContain("Working out your profile…");
  });
});
