"""Score building blocks: tempo map, humanised parts, Gaia's theme, and per-part MIDI output.

Every part's humanising comes from a random generator seeded with its song's and its own name, so the same score
always writes the same MIDI.
"""

import json
import random
from collections.abc import Callable, Mapping, Sequence
from itertools import pairwise
from pathlib import Path
from typing import TypedDict

import mido

from cache import PATCHES

TPB = 960
CC_EXPRESSION = 11
MIDI_PERCUSSION_CHANNEL = 9

NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

PitchSpec = str | int
Rhythm = Sequence[tuple[PitchSpec | None, float]]


class _PartInfo(TypedDict):
    sfz: str
    notes: int
    seat: list[float] | None


def pitch(s: PitchSpec) -> int:
    if isinstance(s, int):
        return s
    n = NAMES[s[0]]
    i = 1
    while i < len(s) and s[i] in "#b":
        n += 1 if s[i] == "#" else -1
        i += 1
    return n + 12 * (int(s[i:]) + 1)


class Clock:
    def __init__(self, segs: Sequence[tuple[float, float, float, int]]) -> None:
        self.segs: list[tuple[float, float, float, float, int, float]] = []
        b = 0.0
        for t0, t1, beats, num in segs:
            self.segs.append((t0, t1, b, beats, num, beats * 60.0 / (t1 - t0)))
            b += beats
        self.total = b

    def sec(self, beat: float) -> float:
        for t0, _t1, b0, n, _num, bpm in self.segs:
            if beat <= b0 + n + 1e-9:
                return t0 + (beat - b0) * 60.0 / bpm
        t0, _t1, b0, _n, _num, bpm = self.segs[-1]
        return t0 + (beat - b0) * 60.0 / bpm

    def beat(self, t: float) -> float:
        for t0, t1, b0, _n, _num, bpm in self.segs:
            if t <= t1 + 1e-9:
                return b0 + (t - t0) * bpm / 60.0
        t0, _t1, b0, _n, _num, bpm = self.segs[-1]
        return b0 + (t - t0) * bpm / 60.0

    def table(self) -> list[dict[str, float | str]]:
        return [
            {"from": t0, "to": t1, "beats": n, "meter": f"{num}/4", "bpm": round(bpm, 1)}
            for t0, t1, _b0, n, num, bpm in self.segs
        ]


class Part:
    def __init__(
        self,
        song: "Song",
        name: str,
        *,
        sfz: str,
        lead: float = 0.0,
        jitter: float = 0.010,
        vjit: int = 4,
        seat: list[float] | None = None,
    ) -> None:
        self.song, self.name, self.sfz, self.lead = song, name, sfz, lead
        self.jitter, self.vjit = jitter, vjit
        self.seat = seat
        self.notes: list[tuple[float, float, int, int]] = []
        self.ccs: list[tuple[float, int, int]] = []
        self.bends: list[tuple[float, int]] = []
        # Deterministic seeded PRNG for musical timing/velocity humanization (not cryptographic).
        self.rng = random.Random(f"{song.name}-{name}")  # noqa: S311

    @property
    def c(self) -> Clock:
        return self.song.clock

    def n(
        self,
        b: float,
        d: float,
        *,
        p: PitchSpec,
        v: float,
        legato: float = 0.03,
        jit: float | None = None,
    ) -> None:
        self.t(self.c.sec(b), self.c.sec(b + d) - self.c.sec(b), p=p, v=v, legato=legato, jit=jit)

    def t(
        self,
        on: float,
        dur: float,
        *,
        p: PitchSpec,
        v: float,
        legato: float = 0.03,
        jit: float | None = None,
    ) -> None:
        j = self.jitter if jit is None else jit
        on2 = on + (self.rng.gauss(0, j / 2) if j else 0.0)
        vel = max(1, min(127, round(v + (self.rng.randint(-self.vjit, self.vjit) if self.vjit else 0))))
        self.notes.append((max(0.0, on2 - self.lead), on + dur + legato, pitch(p), vel))

    def line(
        self,
        b0: float,
        rhythm: Rhythm,
        *,
        v: float | Callable[[int, float], float],
        legato: float = 0.03,
    ) -> float:
        b = b0
        for i, (p, d) in enumerate(rhythm):
            if p is not None:
                vv = v if isinstance(v, int | float) else v(i, b)
                self.n(b, d, p=p, v=vv, legato=legato)
            b += d
        return b

    def roll(
        self,
        t: float,
        pitches: Sequence[PitchSpec],
        *,
        v: float,
        spread: float = 0.05,
        dur: float = 2.0,
        up: bool = True,
    ) -> None:
        ps = pitches if up else list(reversed(pitches))
        for i, p in enumerate(ps):
            self.t(t + i * spread, dur, p=p, v=v + i, jit=0.004)

    def cc(self, t: float, *, num: int, val: float) -> None:
        """Record a CC event, curving CC11 expression with a square root.

        CC11 is written as a dynamic (0-127) and sent through a square root because sfizz applies it as linear
        amplitude: written 32 sounds about -6 dB rather than -12 dB, so soft passages stay audible.
        """
        if num == CC_EXPRESSION:
            val = 127 * (max(0.0, min(127.0, val)) / 127) ** 0.5
        self.ccs.append((t, num, max(0, min(127, round(val)))))

    def ramp(
        self,
        t0: float,
        t1: float,
        *,
        num: int,
        v0: float,
        v1: float,
        shape: float = 1.0,
        step: float = 0.04,
    ) -> None:
        k = max(1, int((t1 - t0) / step))
        for i in range(k + 1):
            x = (i / k) ** shape
            self.cc(t0 + (t1 - t0) * i / k, num=num, val=v0 + (v1 - v0) * x)

    def env(self, points: Sequence[tuple[float, float]], *, num: int = CC_EXPRESSION, step: float = 0.04) -> None:
        for (t0, v0), (t1, v1) in pairwise(points):
            self.ramp(t0, t1, num=num, v0=v0, v1=v1, step=step)

    def bend(self, t0: float, t1: float, *, c0: float, c1: float, step: float = 0.02) -> None:
        k = max(1, int((t1 - t0) / step))
        for i in range(k + 1):
            c = c0 + (c1 - c0) * i / k
            self.bends.append((t0 + (t1 - t0) * i / k, max(-8192, min(8191, round(c / 200 * 8192)))))


def _tick(clock: Clock, seconds: float) -> int:
    return round(clock.beat(seconds) * TPB)


def _tempo_track(clock: Clock, markers: Mapping[str, float]) -> mido.MidiTrack:
    tr = mido.MidiTrack()
    ev: list[tuple[int, mido.MetaMessage]] = []
    for _t0, _t1, b0, _n, num, bpm in clock.segs:
        ev.append((round(b0 * TPB), mido.MetaMessage("set_tempo", tempo=round(60e6 / bpm))))
        ev.append((round(b0 * TPB), mido.MetaMessage("time_signature", numerator=num, denominator=4)))
    for k, t in markers.items():
        ev.append((_tick(clock, t), mido.MetaMessage("marker", text=f"{k} {t:.1f}s")))
    ev.sort(key=lambda e: e[0])
    last = 0
    for t_, m in ev:
        tr.append(m.copy(time=t_ - last))
        last = t_
    return tr


def _part_track(part: Part, clock: Clock, *, channel: int) -> mido.MidiTrack:
    ev: list[tuple[int, int, mido.Message]] = []
    for on, off, note_pitch, vel in part.notes:
        ev.append((_tick(clock, on), 1, mido.Message("note_on", channel=channel, note=note_pitch, velocity=vel)))
        ev.append((_tick(clock, off), 0, mido.Message("note_off", channel=channel, note=note_pitch, velocity=0)))
    for t, num, val in part.ccs:
        ev.append((_tick(clock, t), -1, mido.Message("control_change", channel=channel, control=num, value=val)))
    for t, val in part.bends:
        ev.append((_tick(clock, t), -1, mido.Message("pitchwheel", channel=channel, pitch=val)))
    ev.sort(key=lambda e: (e[0], e[1]))
    tr = mido.MidiTrack()
    tr.append(mido.MetaMessage("track_name", name=part.name))
    last = 0
    for t_, _, m in ev:
        tr.append(m.copy(time=max(0, t_ - last)))
        last = max(last, t_)
    return tr


class Song:
    def __init__(self, name: str, clock: Clock, *, markers: dict[str, float]) -> None:
        self.name, self.clock, self.markers = name, clock, markers
        self.parts: dict[str, Part] = {}

    def part(
        self,
        name: str,
        sfz: str,
        *,
        lead: float = 0.0,
        jitter: float = 0.010,
        vjit: int = 4,
        seat: list[float] | None = None,
    ) -> Part:
        self.parts[name] = Part(self, name, sfz=sfz, lead=lead, jitter=jitter, vjit=vjit, seat=seat)
        return self.parts[name]

    def write(self, out: Path | str, *, meta: Mapping[str, object] | None = None) -> None:
        out_path = Path(out)
        out_path.mkdir(parents=True, exist_ok=True)
        c = self.clock
        full = mido.MidiFile(ticks_per_beat=TPB)
        full.tracks.append(_tempo_track(c, self.markers))
        info: dict[str, _PartInfo] = {}
        for i, p in enumerate(self.parts.values()):
            if not p.notes:
                continue
            one = mido.MidiFile(ticks_per_beat=TPB)
            one.tracks.append(_tempo_track(c, self.markers))
            one.tracks.append(_part_track(p, c, channel=0))
            one.save(out_path / f"{p.name}.mid")
            ch = i % 15 + (1 if i % 15 >= MIDI_PERCUSSION_CHANNEL else 0)
            full.tracks.append(_part_track(p, c, channel=ch))
            info[p.name] = {"sfz": str(p.sfz), "notes": len(p.notes), "seat": p.seat}
        full.save(out_path / f"{self.name}.mid")
        (out_path / "parts.json").write_text(json.dumps(info, indent=1))
        timing = {"clock": c.table(), "events": self.markers, **(meta or {})}
        (out_path / "timing.json").write_text(json.dumps(timing, indent=1))
        total_notes = sum(v["notes"] for v in info.values())
        print(f"{self.name}: {len(info)} parts, {total_notes} notes")
        for row in c.table():
            print("  ", row)


# Gaia's theme, in C major, as (pitch, beats): four two-bar phrases in 4/4.
# P1 rises a sixth and steps down. P2 answers and stops on the dominant. P3 climbs to the high sixth and is left open.
# P4 comes down to the tonic.
THEME4: dict[str, list[tuple[str | None, float]]] = {
    "P1": [("G4", 1), ("E5", 1.5), ("D5", 0.5), ("C5", 1), ("D5", 1), ("E5", 1), ("G5", 2)],
    "P2": [("F5", 1.5), ("E5", 0.5), ("D5", 1), ("A4", 1), ("D5", 3), (None, 1)],
    "P3": [("G4", 1), ("E5", 1.5), ("D5", 0.5), ("C5", 1), ("D5", 1), ("E5", 1), ("A5", 2)],
    "P4": [("G5", 1.5), ("F5", 0.5), ("E5", 1), ("D5", 1), ("C5", 4)],
}


def tr(rhythm: Rhythm, semis: int, *, minor: bool = False) -> list[tuple[int | None, float]]:
    out: list[tuple[int | None, float]] = []
    for p, d in rhythm:
        if p is None:
            out.append((None, d))
            continue
        m = pitch(p)
        if minor and m % 12 in (4, 9, 11):
            m -= 1
        out.append((m + semis, d))
    return out


def dia(p: PitchSpec, steps: int, *, tonic_pc: int) -> int:
    scale = [(tonic_pc + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)]
    m = pitch(p)
    step = 1 if steps > 0 else -1
    for _ in range(abs(steps)):
        m += step
        while m % 12 not in scale:
            m += step
    return m


def extra(name: str) -> str:
    return str(PATCHES / f"{name}.sfz")
