/** Score gaps under this many points (0–100 scale) read "practically a tie", never "0,0 pkt higher". */
export const TIE_PTS = 0.5;

export function scoreGap(pts: number): "tie" | "higher" | "lower" {
  return Math.abs(pts) < TIE_PTS ? "tie" : pts > 0 ? "higher" : "lower";
}
