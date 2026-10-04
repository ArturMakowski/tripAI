// T19 time to value: the confirm after the deck comes pre-filled, and the DNA result is applied without a stop.
import { describe, expect, it } from "vitest";
import { DEFAULT_AIRPORTS, confirmPrefill, prefillDates, profileFromDna } from "./first-run";
import { DNA_DECK, collectAnswers, type DnaSwipe } from "./dna";
import { DEMO_PROFILE } from "./mock/fixtures";
import { profileDna } from "./mock/dna";
import type { BridgeWindow } from "./types";

const TODAY = "2026-10-04";
const RADAR: BridgeWindow[] = [
  {
    window: { start: "2026-11-07", end: "2026-11-11", source: "radar" },
    total_days: 5,
    leave_days: ["2026-11-09", "2026-11-10"],
    holidays: [{ date: "2026-11-11", name: "Święto Niepodległości", source: "nager" }],
    label: "",
  },
];

describe("prefillDates", () => {
  it("preselects the next long weekend (PL holidays + bridge days) as the quick pick", () => {
    // 11 Nov 2026 is a Wednesday: Wed–Sun with Thu + Fri off
    expect(prefillDates([], [], TODAY)).toEqual({ start: "2026-11-11", end: "2026-11-15", quick: "long" });
  });

  it("uses the radar already loaded while swiping", () => {
    const radar: BridgeWindow[] = [
      {
        window: { start: "2026-11-07", end: "2026-11-11", source: "radar" },
        total_days: 5,
        leave_days: ["2026-11-09", "2026-11-10"],
        holidays: [{ date: "2026-11-11", name: "Święto Niepodległości", source: "nager" }],
        label: "",
      },
    ];
    expect(prefillDates([], radar, TODAY)).toMatchObject({ start: "2026-11-07", end: "2026-11-11" });
  });

  it("keeps dates the user already picked", () => {
    expect(prefillDates([{ start: "2027-01-14", end: "2027-01-19" }], [], TODAY)).toBeNull();
  });

  it("ignores picked dates /trips can't use any more (ended, or a 1-day tail)", () => {
    expect(prefillDates([{ start: "2026-09-01", end: "2026-09-05" }], [], TODAY)?.start).toBe("2026-11-11");
    expect(prefillDates([{ start: "2026-10-01", end: "2026-10-04" }], [], TODAY)?.start).toBe("2026-11-11");
  });
});

describe("profileFromDna", () => {
  const swipes: DnaSwipe[] = DNA_DECK.map((c) => ({ id: c.id, value: c.kind === "yesno" ? true : 4 }));
  const result = profileDna({ user_id: "u", ...collectAnswers(swipes) } as Parameters<typeof profileDna>[0]);

  it("applies the confirm's party and airports (a city covers all its airports)", () => {
    const p = profileFromDna(result, null, { airports: ["WAW"], party: 3 });
    expect(p.interests).toEqual(result.profile.interests);
    expect(p.origin_airports).toEqual(["WAW", "WMI"]);
    expect([p.adults, p.children, p.rooms]).toEqual([3, 0, null]);
    expect(p.budget_pln).toBeNull();
  });

  it("defaults to 1 person and the default airport on a first run", () => {
    const p = profileFromDna(result, null);
    expect(p.origin_airports).toEqual(DEFAULT_AIRPORTS);
    expect(p.adults).toBe(1);
  });

  it("keeps what was set in Profile (budget, airports, party) when an answer is edited there", () => {
    const prev = { ...DEMO_PROFILE, budget_pln: 1200, origin_airports: ["GDN"], adults: 2, children: 1, rooms: 2 };
    const p = profileFromDna(result, prev);
    expect([p.budget_pln, p.adults, p.children, p.rooms]).toEqual([1200, 2, 1, 2]);
    expect(p.origin_airports).toEqual(["GDN"]);
  });
});

describe("confirmPrefill (the confirm opening, incl. state saved before T19, and a late radar)", () => {
  const local = { start: "2026-11-11", end: "2026-11-15", quick: "long" as const };

  it("pre-fills when the confirm opens with no dates (old saved state never saw the last swipe)", () => {
    expect(confirmPrefill([], [], TODAY, null)).toEqual(local);
  });

  it("keeps the user's own dates, and an earlier pre-fill after a reload", () => {
    expect(confirmPrefill([{ start: "2027-01-14", end: "2027-01-19" }], [], TODAY, null)).toBeNull();
    expect(confirmPrefill([local], [], TODAY, null)).toBeNull();
  });

  it("replaces its own pre-fill when the radar lands with a different next long weekend", () => {
    expect(confirmPrefill([local], RADAR, TODAY, local)).toMatchObject({ start: "2026-11-07", end: "2026-11-11", quick: "long" });
    // same answer: nothing to do
    expect(confirmPrefill([local], [], TODAY, local)).toBeNull();
  });

  it("never touches dates the user changed after the pre-fill", () => {
    expect(confirmPrefill([], RADAR, TODAY, local)).toBeNull(); // removed it
    expect(confirmPrefill([{ start: "2026-12-24", end: "2026-12-27", quick: "long" }], RADAR, TODAY, local)).toBeNull(); // picked another
    expect(confirmPrefill([local, { start: "2027-01-14", end: "2027-01-19" }], RADAR, TODAY, local)).toBeNull(); // added their own
  });
});
