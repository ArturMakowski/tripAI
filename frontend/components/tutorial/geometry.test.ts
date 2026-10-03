import { describe, expect, it } from "vitest";
import { GAP, HEADER, MARGIN, PAD, placeTip, scrollDelta, trapStep } from "./geometry";

const VH = 844; // iPhone 14 at 390px
const TIP = 170;
const box = (top: number, height: number) => ({ top, left: 20, width: 350, height });

describe("placeTip", () => {
  it("puts the tip below a short anchor when it fits", () => {
    const p = placeTip(box(300, 60), VH, TIP);
    expect(p.side).toBe("below");
    expect(p.tip).toEqual({ top: 300 + 60 + PAD + GAP });
  });

  it("puts it above when there is no room below", () => {
    const p = placeTip(box(650, 60), VH, TIP);
    expect(p.side).toBe("above");
    expect("bottom" in p.tip && VH - p.tip.bottom).toBeLessThanOrEqual(650 - PAD);
  });

  it("never covers a tall anchor: pins the tip and cuts the spotlight above it (review #1)", () => {
    // The Free-time calendar section: ~700px tall at 390px, scrolled to the top under the header.
    const p = placeTip(box(HEADER + MARGIN, 700), VH, TIP);
    expect(p.side).toBe("pinned");
    expect(p.tip).toEqual({ bottom: MARGIN });
    const tipTop = VH - MARGIN - TIP;
    expect(p.spot.top + p.spot.height).toBeLessThanOrEqual(tipTop - GAP);
    // Taller than the viewport: still clipped, never under the header.
    const huge = placeTip(box(-200, 1400), VH, TIP);
    expect(huge.spot.top).toBe(HEADER);
    expect(huge.spot.top + huge.spot.height).toBeLessThanOrEqual(tipTop - GAP);
  });
});

describe("scrollDelta", () => {
  it("centres anchors that fit next to the tip", () => {
    const a = box(700, 60);
    expect(a.top + a.height / 2 - scrollDelta(a, VH, TIP)).toBeCloseTo(HEADER + (VH - HEADER) / 2);
  });

  it("brings tall anchors to just under the header", () => {
    expect(scrollDelta(box(400, 700), VH, TIP)).toBe(400 - HEADER - MARGIN);
  });
});

describe("trapStep (review #2)", () => {
  it("wraps Shift+Tab from the dialog container to the last item instead of leaving the dialog", () => {
    expect(trapStep(3, -1, true)).toBe(2);
    expect(trapStep(3, -1, false)).toBe(0);
  });

  it("wraps at the ends and leaves the middle to the browser", () => {
    expect(trapStep(3, 0, true)).toBe(2);
    expect(trapStep(3, 2, false)).toBe(0);
    expect(trapStep(3, 1, false)).toBeNull();
    expect(trapStep(3, 1, true)).toBeNull();
    expect(trapStep(0, -1, false)).toBeNull();
  });
});
