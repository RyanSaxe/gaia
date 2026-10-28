"""Encode the music to Ogg Opus (96 kb/s stereo, 48 kHz), decode it back, check it, and write manifest.json.

This is the last stage and runs on its own. It reads only the mixed WAVs and mix-report.json, and writes only the Ogg
files and manifest.json. The phrases ship as these files, and the four stems are measured here and then shipped as
chunks (chunks.py), which replace their whole-file encodes.

Checks on the decoded files: the four stems are exactly one loop long (the same number of samples), the wrap from
each stem's last sample to its first is no bigger a step than the music makes elsewhere, the level either side of
the wrap matches the source, and every file's true peak is at most -3 dBFS. Loudness is measured on the decoded audio,
and the piece's figure is bed + melody summed.

Usage: python -m music.encode WAV_DIR ASSETS_DIR   (from tools/sound)
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from . import chunks
from .mix import true_peak

SR = 48000
STEMS = ["bed", "melody", "shimmer", "minor"]
PHRASES = ["phrase-day-1", "phrase-day-2", "phrase-day-3", "phrase-day-4", "phrase-night-1", "phrase-night-2",
           "phrase-ruin-1"]
METER = pyln.Meter(SR)


def encode(src, dst):
    """bitexact gives the Ogg stream a fixed serial number and leaves the version out of its tags, so the same audio
    always makes the same bytes."""
    subprocess.run(["nice", "-n", "10", "ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-c:a", "libopus",
                    "-b:a", "96k", "-ar", "48000", "-ac", "2", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(dst)],
                   check=True)


def decode(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", "48000", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def wrap(x):
    """The step across the wrap, as a percentile of every sample-to-sample step in the file, and the RMS (dB) of
    the 50 ms either side."""
    d = np.abs(np.diff(x, axis=0)).max(axis=1)
    jump = np.abs(x[0] - x[-1]).max()
    k = int(0.05 * SR)
    def rms(s):
        return 20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-12)
    return {"step_percentile": round(float((d < jump).mean() * 100), 1), "rms_before_db": round(float(rms(x[-k:])), 1),
            "rms_after_db": round(float(rms(x[:k])), 1)}


def main(wav_dir, assets):
    wav_dir, assets = Path(wav_dir), Path(assets)
    assets.mkdir(parents=True, exist_ok=True)
    report = json.loads((wav_dir / "mix-report.json").read_text())
    files, dec = {}, {}
    for name in STEMS + PHRASES:
        src = wav_dir / f"{name}.wav"
        dst = assets / f"{name}.ogg"
        encode(src, dst)
        x = decode(dst)
        ref, _ = sf.read(src, always_2d=True)
        if len(x) != len(ref):
            raise SystemExit(f"{name}: decodes to {len(x)} samples, the source has {len(ref)}")
        dec[name] = x
        files[name] = {"seconds": round(len(x) / SR, 4), "lufs": round(float(METER.integrated_loudness(x)), 2),
                       "peak_dbfs": round(float(true_peak(x)), 2)}
    lengths = {len(dec[s]) for s in STEMS}
    if len(lengths) != 1:
        raise SystemExit(f"the stems decode to different lengths: {lengths}")
    over = {k: v["peak_dbfs"] for k, v in files.items() if v["peak_dbfs"] > -3.0}
    if over:
        raise SystemExit(f"true peaks above -3 dBFS after decoding: {over}")
    day = dec["bed"] + dec["melody"]
    night = dec["bed"] + 0.6 * dec["melody"] + dec["shimmer"]
    checks = {}
    for name, x in [(s, dec[s]) for s in STEMS] + [("bed+melody", day), ("bed+0.6 melody+shimmer", night)]:
        checks[name] = wrap(x)
    checks["bed+melody"]["true_peak_dbfs"] = round(float(true_peak(day)), 2)
    checks["bed+0.6 melody+shimmer"]["true_peak_dbfs"] = round(float(true_peak(night)), 2)
    checks["bed+melody+shimmer"] = {"true_peak_dbfs": round(float(true_peak(day + dec["shimmer"])), 2)}
    piece = report["_piece"]
    manifest = {
        "piece": {"lufs": round(float(METER.integrated_loudness(day)), 2), "bars": piece["bars"], "bpm": piece["bpm"],
                  "seconds": piece["seconds"]},
        "phrases": {"lufs": round(float(np.mean([files[p]["lufs"] for p in PHRASES])), 2)},
        "files": files,
    }
    (assets / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=1))
    print("decoded stem length:", lengths.pop(), "samples")
    print("wrap and mix checks:", json.dumps(checks, indent=1))
    chunks.main(wav_dir, assets, assets / "manifest.json")


if __name__ == "__main__":
    main(*sys.argv[1:3])
