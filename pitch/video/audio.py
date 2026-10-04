"""Music + SFX for the TripAI video, normalised to -14 LUFS, muxed onto a silent render.

    uv run --with numpy python audio.py --lang en --video frames/tripai-video-en-1080p-silent.mp4 --out ../out/tripai-video-en.mp4

Sound events come from the picture's own timeline (render.mjs --sfx → audio/sfx-<lang>.json). Each SFX is placed by
its measured peak, so the hit lands on the frame. Sources and licences: CREDITS.md (files are downloaded to audio/src/,
not committed).
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
SRC = HERE / "audio" / "src"
MUSIC = {"file": "113.mp3", "start": 0.21, "gain_db": -3.0}  # House Fest: start on its first downbeat
SFX = {  # kind -> (file, gain dB)
    "tap": ("sfx-1137.mp3", -9.0),
    "swipe": ("sfx-1492.mp3", -12.0),
    "whoosh": ("sfx-1489.mp3", -8.0),
    "pop": ("sfx-2357.mp3", -14.0),
    "notif": ("sfx-2925.mp3", -6.0),
    "success": ("sfx-344.mp3", -8.0),
}
SR = 48000


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def peak_offset(path: Path) -> float:
    """Seconds from the start of the file to its loudest 10 ms window."""
    x = np.abs(decode(path))
    win = int(SR * 0.01)
    env = np.convolve(x, np.ones(win) / win, mode="same")
    return float(np.argmax(env)) / SR


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stderr


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="en")
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    spec = json.loads((HERE / "audio" / f"sfx-{a.lang}.json").read_text())
    dur = spec["duration"]
    peaks = {k: peak_offset(SRC / f) for k, (f, _) in SFX.items()}

    inputs = ["-ss", str(MUSIC["start"]), "-t", str(dur + 0.5), "-i", str(SRC / MUSIC["file"])]
    chains = [f"[0:a]aformat=sample_rates={SR}:channel_layouts=stereo,volume={MUSIC['gain_db']}dB,"
              f"afade=t=in:st=0:d=0.05,afade=t=out:st={dur - 2.2:.2f}:d=2.2[m]"]
    labels = ["[m]"]
    for i, e in enumerate(spec["events"], start=1):
        f, gain = SFX[e["kind"]]
        inputs += ["-i", str(SRC / f)]
        delay_ms = max(0, int(round((e["t"] - peaks[e["kind"]]) * 1000)))
        chains.append(f"[{i}:a]aformat=sample_rates={SR}:channel_layouts=stereo,volume={gain}dB,"
                      f"adelay={delay_ms}|{delay_ms}[s{i}]")
        labels.append(f"[s{i}]")
    mix = f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first,atrim=0:{dur}[mix]"
    graph = ";".join(chains + [mix])
    tmp = HERE / "audio" / f"mix-{a.lang}.wav"
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", graph, "-map", "[mix]", str(tmp)])

    # two-pass loudnorm to -14 LUFS integrated, -1.5 dBTP
    stats = run(["ffmpeg", "-hide_banner", "-i", str(tmp), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
    m = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", stats, re.S).group(0))
    ln = (f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    final = HERE / "audio" / f"final-{a.lang}.wav"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-af", ln, "-ar", str(SR), str(final)])
    check = run(["ffmpeg", "-hide_banner", "-i", str(final), "-af", "ebur128=peak=true", "-f", "null", "-"])
    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", check)[-1]

    run(["ffmpeg", "-y", "-v", "error", "-i", a.video, "-i", str(final), "-map", "0:v", "-map", "1:a",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", a.out])
    print(f"{a.out}: {len(spec['events'])} sfx, integrated {lufs} LUFS")


if __name__ == "__main__":
    main()
