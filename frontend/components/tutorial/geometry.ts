/** Pure layout and focus helpers for the tutorial overlays (unit-tested in geometry.test.ts). */

export type Box = { top: number; left: number; width: number; height: number };

/** Sticky app header height: nothing is spotlit or placed under it. */
export const HEADER = 56;
/** Spotlight padding around the anchor, gap between spotlight and tip, and the viewport margin. */
export const PAD = 6;
export const GAP = 12;
export const MARGIN = 16;

export type TipPlacement = {
  side: "below" | "above" | "pinned";
  /** CSS `top` or `bottom` (px from the viewport edge) for the tip. */
  tip: { top: number } | { bottom: number };
  /** The spotlit area: the anchor, clipped so it never runs under the tip. */
  spot: Box;
};

/**
 * Below the anchor if the tip fits there, else above it. If it fits on neither side (an anchor taller
 * than the viewport leaves room for), the tip is pinned to the bottom edge and the spotlight is cut off
 * above it, so the tip never covers the part of the anchor it talks about.
 */
export function placeTip(anchor: Box, vh: number, tipH: number): TipPlacement {
  const spot = { top: anchor.top - PAD, left: anchor.left - PAD, width: anchor.width + PAD * 2, height: anchor.height + PAD * 2 };
  const spotBottom = spot.top + spot.height;
  const need = tipH + GAP;
  if (vh - spotBottom - MARGIN >= need) return { side: "below", tip: { top: spotBottom + GAP }, spot };
  if (spot.top - HEADER >= need) return { side: "above", tip: { bottom: vh - spot.top + GAP }, spot };
  const top = Math.max(spot.top, HEADER);
  const bottom = Math.max(Math.min(spotBottom, vh - MARGIN - tipH - GAP), top + 24);
  return { side: "pinned", tip: { bottom: MARGIN }, spot: { ...spot, top, height: bottom - top } };
}

/**
 * Where to scroll an anchor: centred when it fits next to the tip, else its top just under the header
 * (centring a tall anchor would leave no room on either side). Returns the scroll delta in px.
 */
export function scrollDelta(anchor: Box, vh: number, tipH: number): number {
  const fits = anchor.height + PAD * 2 + tipH + GAP + MARGIN <= vh - HEADER;
  if (fits) return anchor.top + anchor.height / 2 - (HEADER + (vh - HEADER) / 2);
  return anchor.top - (HEADER + MARGIN);
}

/**
 * Focus trap step: the index to move focus to on Tab, or null to let the browser move it.
 * `current` is the focused item's index, or -1 when focus is on the dialog itself (or outside it):
 * Tab then goes to the first item and Shift+Tab to the last, so focus never escapes the dialog.
 */
export function trapStep(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}
