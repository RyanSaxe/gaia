"""Render every part of every song through its SFZ patch with sfizz_render: 48 kHz float WAVs, three at a time.

sfizz streams long samples from disk in a background thread, and under load a voice can come out silent even when
rendering offline, so each patch is played from a copy that starts with hint_ram_based=1, which loads every sample
whole first. The copy sits beside the patch, because its sample paths are relative to it.

Usage: render.py MIDI_ROOT PARTS_ROOT   (MIDI_ROOT/<song>/ as compose.py writes it; PARTS_ROOT/<song>/<part>.wav)
"""

import json
import subprocess
import sys
import time
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TypedDict

import mido

from cache import SFIZZ, VSCO, run_command
from music.patches import parse, write_if_changed


class _PartMeta(TypedDict):
    sfz: str


def patch(name: str) -> Path:
    return Path(name) if name.startswith("/") else VSCO / name


def in_ram(sfz: Path) -> Path:
    ram = sfz.parent / ("ram-" + sfz.name)
    write_if_changed(ram, "<control>\nhint_ram_based=1\n\n" + sfz.read_text(encoding="latin-1"), encoding="latin-1")
    return ram


def silent_notes(mid_dir: Path, parts: Mapping[str, _PartMeta]) -> dict[str, list[tuple[int, int]]]:
    out: dict[str, list[tuple[int, int]]] = {}
    for name, info in parts.items():
        regs = [
            (
                int(o.get("lokey", o.get("key", 0))),
                int(o.get("hikey", o.get("key", 127))),
                int(o.get("lovel", 0)),
                int(o.get("hivel", 127)),
            )
            for h, o in parse(patch(info["sfz"]).read_text(encoding="latin-1"))
            if h == "region"
        ]
        miss = sorted(
            {
                (m.note, m.velocity)
                for m in mido.MidiFile(mid_dir / f"{name}.mid")
                if m.type == "note_on"
                and m.velocity > 0
                and not any(lo <= m.note <= hi and lv <= m.velocity <= hv for lo, hi, lv, hv in regs)
            }
        )
        if miss:
            out[name] = miss
    return out


def render_song(mid_dir: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    parts: dict[str, _PartMeta] = json.loads((mid_dir / "parts.json").read_text())
    for name, miss in silent_notes(mid_dir, parts).items():
        print(f"{mid_dir.name}/{name}: {len(miss)} notes hit no region, e.g. {miss[:8]}")
    jobs = [(name, in_ram(patch(v["sfz"]))) for name, v in parts.items()]

    def one(job: tuple[str, Path]) -> tuple[str, int]:
        name, sfz = job
        with (out_dir / f"{name}.log").open("w") as log:
            r = run_command(
                SFIZZ,
                [
                    "--sfz",
                    str(sfz),
                    "--midi",
                    str(mid_dir / f"{name}.mid"),
                    "--wav",
                    str(out_dir / f"{name}.wav"),
                    "-s",
                    "48000",
                    "-q",
                    "10",
                    "-p",
                    "256",
                ],
                nice=True,
                check=False,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        return name, r.returncode

    start = time.time()
    with ThreadPoolExecutor(3) as pool:
        failed = [name for name, code in pool.map(one, jobs) if code != 0]
    if failed:
        sys.exit(f"{mid_dir.name}: sfizz_render failed on {failed} (see their .log in {out_dir})")
    print(f"{mid_dir.name}: rendered {len(jobs)} parts in {time.time() - start:.0f} s", flush=True)


def main(midi_root: Path | str, parts_root: Path | str) -> None:
    for d in sorted(Path(midi_root).iterdir()):
        if d.is_dir():
            render_song(d, Path(parts_root) / d.name)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
