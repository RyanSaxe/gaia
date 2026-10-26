"""Render every part of every song through its SFZ patch with sfizz_render: 48 kHz float WAVs, three at a time.

sfizz streams long samples from disk in a background thread, and under load a voice can come out silent even when
rendering offline; each patch is played from a copy that starts with hint_ram_based=1, which loads every sample
whole first. The copy sits beside the patch, because its sample paths are relative to it.

Usage: render.py MIDI_ROOT PARTS_ROOT   (MIDI_ROOT/<song>/ as compose.py writes it; PARTS_ROOT/<song>/<part>.wav)
"""
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import mido

from cache import SFIZZ, VSCO

from .patches import parse, write_if_changed


def patch(name):
    """A part's patch: a VSCO 2 CE file name, or an absolute path to one of patches.py's."""
    return Path(name) if name.startswith("/") else VSCO / name


def in_ram(sfz):
    ram = sfz.parent / ("ram-" + sfz.name)
    write_if_changed(ram, "<control>\nhint_ram_based=1\n\n" + sfz.read_text(encoding="latin-1"), encoding="latin-1")
    return ram


def silent_notes(mid_dir, parts):
    """Notes that land on no region of their patch: sfizz drops them without a word."""
    out = {}
    for name, info in parts.items():
        regs = []
        for h, o in parse(patch(info["sfz"]).read_text(encoding="latin-1")):
            if h == "region":
                regs.append((int(o.get("lokey", o.get("key", 0))), int(o.get("hikey", o.get("key", 127))),
                             int(o.get("lovel", 0)), int(o.get("hivel", 127))))
        miss = sorted({(m.note, m.velocity) for m in mido.MidiFile(mid_dir / f"{name}.mid")
                       if m.type == "note_on" and m.velocity > 0
                       and not any(lo <= m.note <= hi and lv <= m.velocity <= hv for lo, hi, lv, hv in regs)})
        if miss:
            out[name] = miss
    return out


def render_song(mid_dir, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    parts = json.loads((mid_dir / "parts.json").read_text())
    for name, miss in silent_notes(mid_dir, parts).items():
        print(f"{mid_dir.name}/{name}: {len(miss)} notes hit no region, e.g. {miss[:8]}")
    jobs = [(name, in_ram(patch(v["sfz"]))) for name, v in parts.items()]

    def one(job):
        name, sfz = job
        with open(out_dir / f"{name}.log", "w") as log:
            r = subprocess.run(["nice", "-n", "10", str(SFIZZ), "--sfz", str(sfz), "--midi", str(mid_dir / f"{name}.mid"),
                                "--wav", str(out_dir / f"{name}.wav"), "-s", "48000", "-q", "10", "-p", "256"],
                               stdout=log, stderr=subprocess.STDOUT)
        return name, r.returncode

    start = time.time()
    with ThreadPoolExecutor(3) as pool:
        failed = [name for name, code in pool.map(one, jobs) if code != 0]
    if failed:
        raise SystemExit(f"{mid_dir.name}: sfizz_render failed on {failed} (see their .log in {out_dir})")
    print(f"{mid_dir.name}: rendered {len(jobs)} parts in {time.time() - start:.0f} s", flush=True)


def main(midi_root, parts_root):
    for d in sorted(Path(midi_root).iterdir()):
        if d.is_dir():
            render_song(d, Path(parts_root) / d.name)


if __name__ == "__main__":
    main(*sys.argv[1:3])
