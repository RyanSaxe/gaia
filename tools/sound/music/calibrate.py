"""Measure the patches once, so the mix can use fixed faders and the score can even out registers.

- loudness: a patch's reference is three notes across its range (a quarter, half and three quarters of the way up),
  1.6 s each, at velocity 100 with CC1 100 and CC11 127. The mix measures a patch it has no reference for and keeps
  the figure in calibration.json.
- pitches: how loud each pitch of the lead patches plays. VSCO 2's clarinet, for one, plays its upper notes (C6 and
  up) about 10 dB louder than its middle ones at the same velocity, which makes every high note of a calm tune jump
  out. Each patch plays every pitch in its tune range for 1.2 s at the velocity the score uses (CC11 100, CC1 34), and
  the loudness of each note's first 0.8 s is kept in pitchcal.json as a correction (dB, towards the patch's median)
  that compose.py applies.

Usage: python -m music.calibrate pitches   (from tools/sound, after the music's setup. It rewrites pitchcal.json.)
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import mido
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from cache import PATCHES, SFIZZ

from .patches import parse
from .render import in_ram, patch

PITCHCAL = Path(__file__).resolve().parent / "pitchcal.json"
LEADS = {  # patch: (lowest, highest, velocity)
    "ClarinetSus.sfz": (55, 91, 60), "gaia-FluteSusVib.sfz": (60, 93, 66), "OboeSusVib.sfz": (60, 89, 60),
    "gaia-SViolinVib.sfz": (55, 93, 64), "BassoonSus.sfz": (40, 64, 56),
    str(PATCHES / "fs-celesta.sfz"): (72, 100, 38), str(PATCHES / "vcsl-harp.sfz"): (60, 89, 44)}


def keys(path):
    lo, hi = 127, 0
    for h, o in parse(path.read_text(encoding="latin-1")):
        if h == "region":
            lo = min(lo, int(o.get("lokey", o.get("key", 127))))
            hi = max(hi, int(o.get("hikey", o.get("key", 0))))
    return lo, hi


def loudness(name):
    path = patch(name)
    lo, hi = keys(path)
    notes = [int(lo + (hi - lo) * f) for f in (0.25, 0.5, 0.75)]
    with tempfile.TemporaryDirectory() as d:
        mid = mido.MidiFile(ticks_per_beat=480)
        tr = mido.MidiTrack()
        mid.tracks.append(tr)
        tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
        tr.append(mido.Message("control_change", control=1, value=100, time=0))
        tr.append(mido.Message("control_change", control=11, value=127, time=0))
        for n in notes:
            tr.append(mido.Message("note_on", note=n, velocity=100, time=0))
            tr.append(mido.Message("note_off", note=n, velocity=0, time=1536))
        mid.save(f"{d}/ref.mid")
        subprocess.run([str(SFIZZ), "--sfz", str(in_ram(path)), "--midi", f"{d}/ref.mid", "--wav", f"{d}/ref.wav",
                        "-q", "10", "-p", "64"], capture_output=True, check=True)
        x, sr = sf.read(f"{d}/ref.wav", always_2d=True)
    return round(float(pyln.Meter(sr).integrated_loudness(x[: int(4.8 * sr)])), 2), notes


def pitches():
    res = {}
    meter = pyln.Meter(48000)
    for name, (lo, hi, vel) in LEADS.items():
        ps = list(range(lo, hi + 1))
        with tempfile.TemporaryDirectory() as d:
            mid = mido.MidiFile(ticks_per_beat=480)
            tr = mido.MidiTrack()
            mid.tracks.append(tr)
            tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))  # 120 BPM: 960 ticks a second
            tr.append(mido.Message("control_change", control=1, value=34, time=0))
            tr.append(mido.Message("control_change", control=11, value=100, time=0))
            for p in ps:
                tr.append(mido.Message("note_on", note=p, velocity=vel, time=0))
                tr.append(mido.Message("note_off", note=p, velocity=0, time=1152))
                tr.append(mido.Message("control_change", control=11, value=100, time=1728))  # 1.8 s of rest
            mid.save(f"{d}/cal.mid")
            subprocess.run([str(SFIZZ), "--sfz", str(in_ram(patch(name))), "--midi", f"{d}/cal.mid", "--wav",
                            f"{d}/cal.wav", "-s", "48000", "-q", "10", "-p", "64"], capture_output=True, check=True)
            x, sr = sf.read(f"{d}/cal.wav", always_2d=True)
        loud = {}
        for i, p in enumerate(ps):
            t0 = int(i * 3.0 * sr)
            seg = x[t0:t0 + int(0.8 * sr)]
            loud[p] = float(meter.integrated_loudness(seg)) if np.abs(seg).max() > 1e-5 else None
        med = float(np.median([v for v in loud.values() if v is not None and v > -70]))
        key = Path(name).name
        res[key] = {str(p): round(float(np.clip(med - v, -12, 12)), 1) for p, v in loud.items() if v is not None and v > -70}
        print(f"{key:24s} median {med:6.1f}  " + " ".join(f"{p}:{res[key].get(str(p), 0):+.0f}" for p in ps))
    PITCHCAL.write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    if sys.argv[1:] != ["pitches"]:
        raise SystemExit(__doc__)
    pitches()
