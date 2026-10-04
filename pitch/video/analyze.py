"""Marks clip frames where the Travel DNA top card is an undecoded black rectangle (the app re-mounts the card's <img>
after each swipe, so its photo decodes again). The scene jump-cuts past them. Writes meta.clips.dna.skip = [frame, ...].

    uv run --with numpy python analyze.py --lang en
"""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="en")
    a = ap.parse_args()
    root = HERE / "footage" / a.lang
    meta = json.loads((root / "meta.json").read_text())
    clip = meta["clips"]["dna"]
    # a band across the middle of the card (CSS 95..295 x 380..480, DPR 3): black while the photo is undecoded,
    # including the half-decoded frames whose top already shows the photo
    w, h = 100, 50
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-framerate", "30", "-i", str(root / "dna" / "%04d.jpg"),
         "-vf", f"crop=600:300:285:1140,scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
        check=True, capture_output=True,
    ).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, h, w).astype(np.float32)
    dark = [(f.mean() < 45 and f.std() < 14) for f in frames]
    skip = [i for i, d in enumerate(dark) if d]
    clip["skip"] = skip
    (root / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"{a.lang}: {len(skip)} / {len(frames)} dna frames are a black card")


if __name__ == "__main__":
    main()
