"""Chamber band instruments, seating, chord tables, and accompaniment helpers for Gaia's music."""

import json
from collections.abc import Mapping, Sequence
from pathlib import Path

from music.score import THEME4, Part, PitchSpec, Song, extra, pitch, tr

K = 5  # F major
TH = {k: tr(THEME4[k], K) for k in THEME4}

SEATS: dict[str, list[float]] = {
    "cl": [0, -0.2, 0.4, 120, -9, 1.0],
    "fl": [2, 0.15, 0.4, 250, -8, 1.5],
    "ob": [-1, 0.05, 0.4, 200, -8, 1.0],
    "bn": [-8, 0.3, 0.4, 60, -10, 0.0],
    "bns": [-7, 0.3, 0.4, 60, -10, 0.0],
    "cel": [-6, -0.35, 0.6, 300, -6, 1.0],
    "hp": [-5, -0.5, 0.6, 70, -8, 1.5],
    "hpl": [-5, -0.3, 0.5, 70, -8, 1.5],
    "glk": [-12, 0.3, 0.5, 400, -6, 0.0],
    "sv": [3, -0.15, 0.4, 200, -8, 2.5],
    "vn": [-2, -0.45, 0.7, 180, -9, 2.0],
    "va": [-4, 0.15, 0.7, 120, -9, 1.5],
    "vc": [-3, 0.35, 0.7, 50, -10, 0.0],
    "cb": [-9, 0.5, 0.6, 35, -12, 0.0],
    "vnp": [-9, -0.4, 0.6, 200, -10, 1.5],
    "vap": [-10, 0.15, 0.6, 120, -10, 1.0],
    "vcp": [-7, 0.35, 0.6, 50, -11, 0.0],
}
PATCH = {
    "cl": "ClarinetSus.sfz",
    "fl": "gaia-FluteSusVib.sfz",
    "ob": "OboeSusVib.sfz",
    "bn": "BassoonStac.sfz",
    "bns": "BassoonSus.sfz",
    "cel": extra("fs-celesta"),
    "hp": extra("vcsl-harp"),
    "hpl": extra("vcsl-harp"),
    "glk": extra("vcsl-glock"),
    "sv": "gaia-SViolinVib.sfz",
    "vn": "gaia-ViolinEnsSusVib.sfz",
    "va": "gaia-ViolaEnsSusVib.sfz",
    "vc": "gaia-CelloEnsSusVib.sfz",
    "cb": "gaia-ContrabassSusVB.sfz",
    "vnp": "ViolinEnsPizz.sfz",
    "vap": "ViolaEnsPizz.sfz",
    "vcp": "CelloEnsPizz.sfz",
}
LEAD = {
    "cl": 0.03,
    "fl": 0.05,
    "ob": 0.03,
    "bn": 0.01,
    "bns": 0.03,
    "cel": 0.004,
    "hp": 0.02,
    "hpl": 0.02,
    "glk": 0.005,
    "sv": 0.05,
    "vn": 0.14,
    "va": 0.12,
    "vc": 0.08,
    "cb": 0.06,
    "vnp": 0.004,
    "vap": 0.004,
    "vcp": 0.004,
}
CROSSFADED = ("fl", "sv", "vn", "va", "vc", "cb")  # gaia-* patches: CC1 picks the layer, CC11 is the volume

# chords: (bass pitch class name, root pitch class name, pitch classes above the root)
CHORDS = {
    "F": ("F", "F", [0, 4, 7]),
    "Am": ("A", "A", [0, 3, 7]),
    "Bb": ("Bb", "Bb", [0, 4, 7]),
    "Csus": ("C", "C", [0, 5, 7, 10]),
    "C7": ("C", "C", [0, 4, 7, 10]),
    "Dm": ("D", "D", [0, 3, 7]),
    "Gm": ("G", "G", [0, 3, 7]),
    "Gm7": ("G", "G", [0, 3, 7, 10]),
    "F/A": ("A", "F", [0, 4, 7]),
    "F/C": ("C", "F", [0, 4, 7]),
    "Fadd9": ("F", "F", [0, 4, 7, 14]),
    "Fm": ("F", "F", [0, 3, 7]),
    "Ab": ("Ab", "Ab", [0, 4, 7]),
    "Bbm": ("Bb", "Bb", [0, 3, 7]),
    "Db": ("Db", "Db", [0, 4, 7]),
    "Gh7": ("G", "G", [0, 3, 6, 10]),
    "Fm/Ab": ("Ab", "F", [0, 3, 7]),
    "Fm/C": ("C", "F", [0, 3, 7]),
    "Fmadd9": ("F", "F", [0, 3, 7, 14]),
    "Dbmaj7": ("Db", "Db", [0, 4, 7, 11]),
    "Bbm6": ("Bb", "Bb", [0, 3, 7, 9]),
    "C": ("C", "C", [0, 4, 7]),
}
PC = {"C": 0, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "Gb": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}

# string voicings (cb, vc, va, vn), led so each voice moves by step where it can
STR: dict[str, tuple[str, ...]] = {
    "F": ("F2", "C3", "A3", "F4"),
    "Fadd9": ("F2", "C3", "A3", "G4"),
    "Am": ("A2", "E3", "A3", "E4"),
    "Bb": ("Bb2", "F3", "Bb3", "D4"),
    "Csus": ("C3", "G3", "Bb3", "F4"),
    "C7": ("C3", "G3", "Bb3", "E4"),
    "Dm": ("D3", "F3", "A3", "F4"),
    "Gm7": ("G2", "F3", "Bb3", "D4"),
    "Gm": ("G2", "G3", "Bb3", "D4"),
    "F/A": ("A2", "F3", "A3", "C4"),
    "F/C": ("C3", "F3", "A3", "C4"),
}
# the minor bed: lower, no violins
STRM: dict[str, tuple[str, ...]] = {
    "Fm": ("F2", "C3", "Ab3"),
    "Ab": ("Ab2", "Eb3", "C4"),
    "Bbm": ("Bb2", "F3", "Db4"),
    "Csus": ("C3", "F3", "Bb3"),
    "C7": ("C3", "G3", "E4"),
    "Db": ("Db3", "F3", "Ab3"),
    "Gh7": ("G2", "F3", "Db4"),
    "Fm/Ab": ("Ab2", "F3", "C4"),
    "Fm/C": ("C3", "F3", "Ab3"),
}
TO_MINOR = {
    "F": "Fm",
    "Fadd9": "Fm",
    "Am": "Ab",
    "Bb": "Bbm",
    "Csus": "Csus",
    "C7": "C7",
    "Dm": "Db",
    "Gm7": "Gh7",
    "Gm": "Gh7",
    "F/A": "Fm/Ab",
    "F/C": "Fm/C",
}

Progression = list[list[tuple[str, float]]]

PITCHCAL: dict[str, dict[str, float]] = json.loads((Path(__file__).resolve().parent / "pitchcal.json").read_text())
EVEN = 0.8  # how much of each pitch's measured correction to apply, so some natural register contour stays
STEP = 2  # dB between gain groups


def pcs(ch: str) -> set[int]:
    _, root, iv = CHORDS[ch]
    return {(PC[root] + i) % 12 for i in iv}


def bass_pitch(ch: str, lo: int = 40) -> int:
    b = PC[CHORDS[ch][0]]
    return lo + (b - lo) % 12


def arp(ch: str, *, n: int = 7, lo: int = 40, top: int | None = None) -> list[int]:
    b = bass_pitch(ch, lo)
    tones = sorted(pcs(ch))
    out = [b]
    m = b + 5
    while len(out) < n:
        if m % 12 in tones and (top is None or m <= top):
            out.append(m)
        m += 1
        if top is not None and m > top:
            break
    return out


def near(pc_set: set[int], *, lo: PitchSpec, hi: PitchSpec, prefer: tuple[int, ...] = (0, 5, 7, 10)) -> list[int]:
    ms = [m for m in range(pitch(lo), pitch(hi) + 1) if m % 12 in pc_set]
    return sorted(ms, key=lambda m: (prefer.index(m % 12) if m % 12 in prefer else 9, m))


class Band:
    def __init__(self, song: Song, prefix: str = "") -> None:
        self.song, self.prefix = song, prefix
        self.parts: dict[str, Part] = {}

    def __getattr__(self, inst: str) -> Part:
        if inst.startswith("_") or inst not in PATCH:
            raise AttributeError(inst)
        if inst not in self.parts:
            p = self.song.part(
                self.prefix + inst,
                PATCH[inst],
                lead=LEAD[inst],
                jitter=0.006 if inst in ("cel", "glk", "hp", "hpl") else 0.010,
            )
            if inst in CROSSFADED:
                p.cc(0, num=1, val=34)
                p.cc(0, num=11, val=60)
            else:
                p.cc(0, num=11, val=80)
            self.parts[inst] = p
        return self.parts[inst]


def even_out(song: Song, seats: dict[str, list[float]], *, stems: dict[str, list[str]]) -> None:
    """Split each calibrated part into gain groups so its registers play evenly.

    Every note goes to the part for its correction rounded to STEP dB, and each group gets the same CC curves and its
    own fader. Seats and stems are rewritten to match.
    """
    for name, part in list(song.parts.items()):
        table = PITCHCAL.get(Path(part.sfz).name)
        if not table or not part.notes:
            continue
        groups: dict[int, list[tuple[float, float, int, int]]] = {}
        for note in part.notes:
            k = round(EVEN * table.get(str(note[2]), 0.0) / STEP) * STEP
            groups.setdefault(k, []).append(note)
        del song.parts[name]
        base = seats.pop(name)
        stem = next(g for g, ns in stems.items() if name in ns)
        stems[stem].remove(name)
        for k, notes in sorted(groups.items()):
            sub = Part(song, f"{name}_{'p' if k >= 0 else 'm'}{abs(k)}", sfz=part.sfz, lead=part.lead)
            sub.notes, sub.ccs, sub.bends = notes, list(part.ccs), list(part.bends)
            song.parts[sub.name] = sub
            seats[sub.name] = [base[0] + k, *base[1:]]
            stems[stem].append(sub.name)


def swell(
    part: Part,
    b0: float,
    *,
    b1: float,
    lo: float,
    hi: float,
    peak: float = 0.6,
    num: int = 11,
) -> None:
    sec = part.c.sec
    bm = b0 + (b1 - b0) * peak
    part.env([(sec(b0), lo), (sec(bm), hi), (sec(b1), lo)], num=num)


def strings(
    band: Band,
    b0: float,
    *,
    prog: Sequence[tuple[str, float]],
    v: float = 80,
    voices: Sequence[str] = ("cb", "vc", "va", "vn"),
    table: Mapping[str, tuple[str, ...]] = STR,
    tie: bool = True,
) -> None:
    for i, inst in enumerate(voices):
        part: Part = getattr(band, inst)
        b = b0
        cur: tuple[str, float, float] | None = None
        for ch, d in prog:
            p = table[ch][i]
            if tie and cur and cur[0] == p:
                cur = (p, cur[1], cur[2] + d)
            else:
                if cur:
                    part.n(cur[1], cur[2], p=cur[0], v=v, legato=0.04)
                cur = (p, b, d)
            b += d
        if cur:
            part.n(cur[1], cur[2], p=cur[0], v=v, legato=0.04)


def harp_wave(
    band: Band,
    b0: float,
    *,
    ch: str,
    v: float,
    beats: float = 4,
    part: Part | None = None,
) -> None:
    hp = part or band.hp
    a = arp(ch, n=5)
    order = [0, 1, 2, 3, 4, 3, 2, 1]
    for k in range(round(beats * 2)):
        hp.n(b0 + k * 0.5, 1.2, p=a[order[k % 8]], v=v + (6 if k % 4 == 0 else 0) - (2 if k % 2 else 0))


def harp_quarters(
    band: Band,
    b0: float,
    *,
    ch: str,
    v: float,
    beats: float = 4,
    part: Part | None = None,
    lo: int = 40,
) -> None:
    hp = part or band.hp
    a = arp(ch, n=4, lo=lo)
    for k in range(int(beats)):
        hp.n(b0 + k, 1.8, p=a[k % 4], v=v + (5 if k == 0 else 0))


def roll(
    part: Part,
    b0: float,
    *,
    pitches: Sequence[int],
    v: float,
    spread: float = 0.06,
    beats: float = 2.0,
) -> None:
    sec = part.c.sec
    for i, p in enumerate(pitches):
        part.t(sec(b0) + i * spread, sec(b0 + beats) - sec(b0), p=p, v=v + i, jit=0.003)
