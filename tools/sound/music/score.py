"""The score's building blocks: a tempo map, parts with humanised notes and CC swells, Gaia's theme, and MIDI output
for sfizz_render (one file per part).

Every part's humanising comes from a random generator seeded with its song's and its own name, so the same score
always writes the same MIDI.
"""
import json
import random
from pathlib import Path

import mido

from cache import PATCHES

TPB = 960

NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def P(s):
    """'F#5' -> 78 (C4 = 60). Ints pass through."""
    if isinstance(s, int):
        return s
    n = NAMES[s[0]]
    i = 1
    while i < len(s) and s[i] in "#b":
        n += 1 if s[i] == "#" else -1
        i += 1
    return n + 12 * (int(s[i:]) + 1)


class Clock:
    """Tempo map from segments [(t0, t1, beats, numerator)]: each segment's tempo fits its beats exactly."""

    def __init__(self, segs):
        self.segs = []
        b = 0.0
        for t0, t1, beats, num in segs:
            self.segs.append((t0, t1, b, beats, num, beats * 60.0 / (t1 - t0)))
            b += beats
        self.total = b

    def sec(self, beat):
        for t0, t1, b0, n, num, bpm in self.segs:
            if beat <= b0 + n + 1e-9:
                return t0 + (beat - b0) * 60.0 / bpm
        t0, t1, b0, n, num, bpm = self.segs[-1]
        return t0 + (beat - b0) * 60.0 / bpm

    def beat(self, t):
        for t0, t1, b0, n, num, bpm in self.segs:
            if t <= t1 + 1e-9:
                return b0 + (t - t0) * bpm / 60.0
        t0, t1, b0, n, num, bpm = self.segs[-1]
        return b0 + (t - t0) * bpm / 60.0

    def table(self):
        return [{"from": t0, "to": t1, "beats": n, "meter": f"{num}/4", "bpm": round(bpm, 1)} for t0, t1, b0, n, num, bpm in self.segs]


class Part:
    def __init__(self, song, name, sfz, lead=0.0, jitter=0.010, vjit=4, seat=None):
        self.song, self.name, self.sfz, self.lead = song, name, sfz, lead
        self.jitter, self.vjit = jitter, vjit
        self.seat = seat
        self.notes, self.ccs, self.bends = [], [], []
        self.rng = random.Random(f"{song.name}-{name}")

    @property
    def c(self):
        return self.song.clock

    def n(self, b, d, p, v, legato=0.03, jit=None):
        """A note at beat b lasting d beats."""
        self.t(self.c.sec(b), self.c.sec(b + d) - self.c.sec(b), p, v, legato, jit)

    def t(self, on, dur, p, v, legato=0.03, jit=None):
        """A note at `on` seconds lasting `dur` seconds."""
        j = self.jitter if jit is None else jit
        on2 = on + (self.rng.gauss(0, j / 2) if j else 0.0)
        v = max(1, min(127, int(round(v + (self.rng.randint(-self.vjit, self.vjit) if self.vjit else 0)))))
        self.notes.append((max(0.0, on2 - self.lead), on + dur + legato, P(p), v))

    def line(self, b0, rhythm, v, legato=0.03, shape=None):
        """rhythm: [(pitch or None, beats)]. v may be a number or a function of the note index."""
        b = b0
        for i, (p, d) in enumerate(rhythm):
            if p is not None:
                vv = v(i, b) if callable(v) else v
                self.n(b, d, p, vv, legato=legato)
            b += d
        return b

    def roll(self, t, pitches, v, spread=0.05, dur=2.0, up=True):
        ps = pitches if up else list(reversed(pitches))
        for i, p in enumerate(ps):
            self.t(t + i * spread, dur, p, v + i, jit=0.004)

    def cc(self, t, num, val):
        """CC11 is written as a dynamic (0-127) and sent through a square root, because sfizz applies it as linear
        amplitude: written 32 sounds about -6 dB rather than -12 dB, so soft passages stay audible."""
        if num == 11:
            val = 127 * (max(0.0, min(127.0, val)) / 127) ** 0.5
        self.ccs.append((t, num, int(max(0, min(127, round(val))))))

    def ramp(self, t0, t1, num, v0, v1, shape=1.0, step=0.04):
        k = max(1, int((t1 - t0) / step))
        for i in range(k + 1):
            x = (i / k) ** shape
            self.cc(t0 + (t1 - t0) * i / k, num, v0 + (v1 - v0) * x)

    def env(self, points, num=11, step=0.04):
        """Piecewise CC curve: [(t, value), ...]."""
        for (t0, v0), (t1, v1) in zip(points[:-1], points[1:]):
            self.ramp(t0, t1, num, v0, v1, step=step)

    def bend(self, t0, t1, c0, c1, step=0.02):
        """Pitch bend from c0 to c1 cents (range +-200)."""
        k = max(1, int((t1 - t0) / step))
        for i in range(k + 1):
            c = c0 + (c1 - c0) * i / k
            self.bends.append((t0 + (t1 - t0) * i / k, int(max(-8192, min(8191, round(c / 200 * 8192))))))


class Song:
    def __init__(self, name, clock, markers):
        """markers: {name: seconds}, written into the tempo track for reading the MIDI in a sequencer."""
        self.name, self.clock, self.markers = name, clock, markers
        self.parts = {}

    def part(self, name, sfz, **kw):
        self.parts[name] = Part(self, name, sfz, **kw)
        return self.parts[name]

    def write(self, out, meta=None):
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        c = self.clock

        def tick(t):
            return int(round(c.beat(t) * TPB))

        def tempo_track():
            tr = mido.MidiTrack()
            ev = []
            for t0, t1, b0, n, num, bpm in c.segs:
                ev.append((int(round(b0 * TPB)), mido.MetaMessage("set_tempo", tempo=int(round(60e6 / bpm)))))
                ev.append((int(round(b0 * TPB)), mido.MetaMessage("time_signature", numerator=num, denominator=4)))
            for k, t in self.markers.items():
                ev.append((tick(t), mido.MetaMessage("marker", text=f"{k} {t:.1f}s")))
            ev.sort(key=lambda e: e[0])
            last = 0
            for t_, m in ev:
                tr.append(m.copy(time=t_ - last))
                last = t_
            return tr

        def part_track(p, ch):
            ev = []
            for on, off, pitch, vel in p.notes:
                ev.append((tick(on), 1, mido.Message("note_on", channel=ch, note=pitch, velocity=vel)))
                ev.append((tick(off), 0, mido.Message("note_off", channel=ch, note=pitch, velocity=0)))
            for t, num, val in p.ccs:
                ev.append((tick(t), -1, mido.Message("control_change", channel=ch, control=num, value=val)))
            for t, val in p.bends:
                ev.append((tick(t), -1, mido.Message("pitchwheel", channel=ch, pitch=val)))
            ev.sort(key=lambda e: (e[0], e[1]))
            tr = mido.MidiTrack()
            tr.append(mido.MetaMessage("track_name", name=p.name))
            last = 0
            for t_, _, m in ev:
                tr.append(m.copy(time=max(0, t_ - last)))
                last = max(last, t_)
            return tr

        full = mido.MidiFile(ticks_per_beat=TPB)
        full.tracks.append(tempo_track())
        info = {}
        for i, p in enumerate(self.parts.values()):
            if not p.notes:
                continue
            one = mido.MidiFile(ticks_per_beat=TPB)
            one.tracks.append(tempo_track())
            one.tracks.append(part_track(p, 0))
            one.save(out / f"{p.name}.mid")
            full.tracks.append(part_track(p, i % 15 + (1 if i % 15 >= 9 else 0)))
            info[p.name] = {"sfz": str(p.sfz), "notes": len(p.notes), "seat": p.seat}
        full.save(out / f"{self.name}.mid")
        json.dump(info, open(out / "parts.json", "w"), indent=1)
        json.dump({"clock": c.table(), "events": self.markers, **(meta or {})}, open(out / "timing.json", "w"), indent=1)
        print(f"{self.name}: {len(info)} parts, {sum(v['notes'] for v in info.values())} notes")
        for row in c.table():
            print("  ", row)


# Gaia's theme, in C major, as (pitch, beats): four two-bar phrases in 4/4.
# P1 rises a sixth and steps down. P2 answers and stops on the dominant. P3 climbs to the high sixth and is left open.
# P4 comes down to the tonic.
THEME4 = {
    "P1": [("G4", 1), ("E5", 1.5), ("D5", .5), ("C5", 1), ("D5", 1), ("E5", 1), ("G5", 2)],
    "P2": [("F5", 1.5), ("E5", .5), ("D5", 1), ("A4", 1), ("D5", 3), (None, 1)],
    "P3": [("G4", 1), ("E5", 1.5), ("D5", .5), ("C5", 1), ("D5", 1), ("E5", 1), ("A5", 2)],
    "P4": [("G5", 1.5), ("F5", .5), ("E5", 1), ("D5", 1), ("C5", 4)],
}
def tr(rhythm, semis, minor=False):
    """Transposes a phrase. minor=True flattens the 3rd, 6th and 7th degrees of C (E, A, B) before transposing."""
    out = []
    for p, d in rhythm:
        if p is None:
            out.append((None, d))
            continue
        m = P(p)
        if minor and m % 12 in (4, 9, 11):
            m -= 1
        out.append((m + semis, d))
    return out


def dia(p, steps, tonic_pc):
    """Move a pitch `steps` scale degrees within the major scale on tonic_pc (negative = down)."""
    scale = [(tonic_pc + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)]
    m = P(p)
    step = 1 if steps > 0 else -1
    for _ in range(abs(steps)):
        m += step
        while m % 12 not in scale:
            m += step
    return m


def extra(name):
    """A patch written into the cache by patches.py (the harp, glockenspiel and celesta), by its absolute path."""
    return str(PATCHES / f"{name}.sfz")
