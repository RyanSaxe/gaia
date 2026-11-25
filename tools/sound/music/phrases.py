"""Standalone phrases built from Gaia's theme, from silence to a natural decay.

Each phrase opens with one bar of harp and strings before the lead enters and lets its final chord ring out.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from music.band import (
    SEATS,
    STR,
    STRM,
    TH,
    Band,
    Progression,
    arp,
    bass_pitch,
    even_out,
    harp_quarters,
    harp_wave,
    near,
    pcs,
    roll,
    strings,
    swell,
)
from music.score import Clock, Part, PitchSpec, Song, pitch

DAY3_LAST_PHRASE_BEAT = 24


@dataclass(frozen=True)
class _PhraseContext:
    band: Band
    start: float
    fin: float


def _write_phrase_bed(
    band: Band,
    bars: Progression,
    *,
    start: float,
    bed: str,
    harp_v: int,
) -> None:
    for k, bar in enumerate(bars):
        b = start + 4 * k
        for ch, d in bar:
            if bed == "eighths":
                harp_wave(band, b, ch=ch, v=harp_v, beats=d)
            elif bed == "quarters":
                harp_quarters(band, b, ch=ch, v=harp_v, beats=d)
            elif bed == "rolls":
                roll(band.hp, b, pitches=arp(ch, n=6), v=harp_v, spread=0.09, beats=d)
            b += d


def _apply_seat_adjustments(
    seats: dict[str, list[float]],
    seats_adj: Mapping[str, tuple[int, float]] | None,
) -> None:
    for inst, (i, dv) in (seats_adj or {}).items():
        if inst in seats:
            seats[inst][i] += dv


def phrase(
    out: Path | str,
    name: str,
    *,
    bpm: float,
    prog: Progression,
    lead: Callable[[Band, float], None],
    extra_fn: Callable[[_PhraseContext], None] | None = None,
    intro: int = 1,
    ring: float = 2,
    bed: str = "eighths",
    strings_level: int = 46,
    voices: tuple[str, ...] = ("cb", "vc", "va", "vn"),
    table: Mapping[str, tuple[str, ...]] = STR,
    harp_v: int = 40,
    seats_adj: Mapping[str, tuple[int, float]] | None = None,
) -> None:
    """Write a standalone phrase from silence with an intro bar and ringing final chord.

    prog is per-bar chord lists after the intro bar, which plays the first chord. lead(band, b0) writes the tune from
    the first bar after the intro. The last chord rings for `ring` bars.
    """
    bars = [[(prog[0][0][0], 4.0)]] * intro + prog
    nb = len(bars)
    total = 4 * (nb + ring) + 4
    clock = Clock([(0.0, total * 60 / bpm, total, 4)])
    s = Song(name, clock, markers={"end": total * 60 / bpm})
    sec = clock.sec
    band = Band(s)
    start = 0.5  # half a beat of silence before the first note
    flat = [c for bar in bars for c in bar]
    last = flat[-1][0]
    strings(
        band,
        start,
        prog=[*flat[:-1], (last, flat[-1][1] + 4 * ring - 1)],
        v=80,
        voices=voices,
        table=table,
    )
    end_t = sec(start + 4 * (nb + ring) - 1)
    for i, inst in enumerate(voices):
        p: Part = getattr(band, inst)
        lvl = strings_level + (-4, 0, -2, -8)[i]
        p.env([(sec(start) - 0.2, 0), (sec(start) + 1.6, lvl), (sec(start + 4 * nb), lvl + 2), (end_t, 0)])
        p.cc(0, num=1, val=30)
    _write_phrase_bed(band, bars, start=start, bed=bed, harp_v=harp_v)
    fin = start + 4 * nb
    roll(band.hp, fin, pitches=arp(last, n=7), v=harp_v + 4, spread=0.08, beats=4 * ring)
    lead(band, start + 4 * intro)
    if extra_fn:
        extra_fn(_PhraseContext(band=band, start=start, fin=fin))
    seats = {inst: list(SEATS[inst]) for inst in band.parts}
    _apply_seat_adjustments(seats, seats_adj)
    stems = {"all": list(band.parts)}
    even_out(s, seats, stems=stems)
    s.write(
        Path(out) / name,
        meta={
            "kind": "phrase",
            "bpm": bpm,
            "bars": nb + ring,
            "seats": seats,
            "reverb": {"rt": [2.4, 2.1, 1.7, 1.0], "length": 3.0},
            "stems": stems,
        },
    )


A_PROG: Progression = [
    [("F", 4)],
    [("Am", 4)],
    [("Bb", 4)],
    [("Csus", 2), ("C7", 2)],
    [("Dm", 4)],
    [("Bb", 4)],
    [("Gm7", 2), ("C7", 2)],
    [("F", 4)],
]


def day1(out: Path | str) -> None:
    def lead(band: Band, b0: float) -> None:
        band.cl.line(
            b0,
            TH["P1"] + TH["P2"] + TH["P3"] + TH["P4"][:-1] + [("F5", 5)],
            v=lambda i, _b: 60 + (5 if i in (1, 6) else 0),
            legato=0.05,
        )
        swell(band.cl, b0, b1=b0 + 16, lo=64, hi=82)
        swell(band.cl, b0 + 16, b1=b0 + 34, lo=66, hi=84, peak=0.45)

    def pluck(ctx: _PhraseContext) -> None:
        for k in range(1, 9):
            ctx.band.vcp.n(ctx.start + 4 * k, 0.5, p=bass_pitch(A_PROG[k - 1][0][0], 36), v=54)

    phrase(out, "phrase-day-1", bpm=76, prog=A_PROG, lead=lead, extra_fn=pluck, seats_adj={"cl": (0, 2)})


def day2(out: Path | str) -> None:
    prog: Progression = [
        [("F", 4)],
        [("C7", 4)],
        [("Bb", 4)],
        [("Csus", 2), ("C7", 2)],
        [("F/A", 4)],
        [("Bb", 4)],
        [("Gm7", 2), ("C7", 2)],
        [("F", 4)],
    ]

    def lead(band: Band, b0: float) -> None:
        tune: list[tuple[PitchSpec | None, float]] = [
            ("C5", 1),
            ("A5", 1),
            ("G5", 0.5),
            ("A5", 0.5),
            ("F5", 1),
            ("G5", 0.5),
            ("A5", 0.5),
            ("Bb5", 0.5),
            ("A5", 0.5),
            ("C6", 2),
            ("Bb5", 1),
            ("A5", 0.5),
            ("G5", 0.5),
            ("F5", 0.5),
            ("G5", 0.5),
            ("D5", 1),
            ("G5", 2.5),
            (None, 1.5),
            ("C5", 1),
            ("A5", 1),
            ("G5", 0.5),
            ("A5", 0.5),
            ("F5", 1),
            ("G5", 0.5),
            ("A5", 0.5),
            ("C6", 0.5),
            ("D6", 0.5),
            ("D6", 2),
            ("C6", 1),
            ("Bb5", 0.5),
            ("A5", 0.5),
            ("G5", 0.5),
            ("F5", 0.5),
            ("E5", 0.5),
            ("G5", 0.5),
            ("F5", 5),
        ]
        band.fl.line(b0, tune, v=66, legato=0.04)
        swell(band.fl, b0 - 0.2, b1=b0 + 8, lo=56, hi=76)
        swell(band.fl, b0 + 8, b1=b0 + 16, lo=58, hi=80)
        swell(band.fl, b0 + 16, b1=b0 + 37, lo=60, hi=82, peak=0.4)

    def tiptoe(ctx: _PhraseContext) -> None:
        for k, bar in enumerate([[("F", 4.0)], *prog]):
            b = ctx.start + 4 * k
            for ch, d in bar:
                for q in range(int(d)):
                    if (b + q - ctx.start) % 2 == 0:
                        ctx.band.vcp.n(b + q, 0.5, p=bass_pitch(ch, 36), v=56 + (6 if q == 0 else 0))
                    else:
                        ctx.band.vnp.n(b + q, 0.5, p=max(near(pcs(ch), lo="D5", hi="A5", prefer=())), v=48)
                        ctx.band.vap.n(b + q, 0.5, p=max(near(pcs(ch), lo="F4", hi="C5", prefer=())), v=44)
                b += d
        ctx.band.cel.n(ctx.fin + 0.5, 2, p="C7", v=34)
        ctx.band.cel.n(ctx.fin + 0.52, 2, p="F6", v=32)

    phrase(
        out,
        "phrase-day-2",
        bpm=80,
        prog=prog,
        lead=lead,
        extra_fn=tiptoe,
        bed="rolls",
        strings_level=42,
        harp_v=36,
        seats_adj={"fl": (0, 2)},
    )


def day3(out: Path | str) -> None:
    prog: Progression = [
        [("F", 4)],
        [("Am", 4)],
        [("Gm", 4)],
        [("Dm", 2), ("C7", 2)],
        [("Bb", 4)],
        [("F/A", 4)],
        [("Gm7", 2), ("C7", 2)],
        [("F", 4)],
    ]

    def lead(band: Band, b0: float) -> None:
        tune: list[tuple[PitchSpec | None, float]] = [
            *TH["P1"],
            ("Bb4", 1),
            ("G5", 1.5),
            ("F5", 0.5),
            ("D5", 1),
            ("E5", 1),
            ("F5", 1),
            ("G5", 1.6),
            (None, 0.4),
            ("F5", 1),
            ("D6", 1.5),
            ("C6", 0.5),
            ("Bb5", 1),
            ("A5", 1),
            ("G5", 1),
            ("F5", 1.6),
            (None, 0.4),
            ("C6", 1.5),
            ("Bb5", 0.5),
            ("A5", 1),
            ("G5", 1),
            ("F5", 5),
        ]
        band.sv.line(b0, tune, v=lambda i, _b: 66 + (5 if i in (1, 8, 15) else 0), legato=0.05)
        for a in (0, 8, 16, DAY3_LAST_PHRASE_BEAT):
            swell(
                band.sv,
                b0 + a - 0.2,
                b1=b0 + a + 8 + (3 if a == DAY3_LAST_PHRASE_BEAT else 0),
                lo=50,
                hi=76,
                peak=0.5,
            )

    phrase(
        out,
        "phrase-day-3",
        bpm=72,
        prog=prog,
        lead=lead,
        ring=1.5,
        voices=("vc",),
        table={k: (v[1],) for k, v in STR.items()},
        strings_level=44,
        harp_v=42,
        seats_adj={"vc": (0, -2), "sv": (0, 5)},
    )


def day4(out: Path | str) -> None:
    def lead(band: Band, b0: float) -> None:
        ob, bn = band.ob, band.bns
        ob.line(b0, TH["P1"], v=62, legato=0.05)
        bn.line(
            b0 + 8,
            [("D3", 1), ("Bb3", 1.5), ("A3", 0.5), ("G3", 1), ("F3", 1), ("G3", 1), ("C3", 2)],
            v=58,
            legato=0.05,
        )
        ob.line(b0 + 16, TH["P3"], v=64, legato=0.05)
        bn.line(b0 + 16, [("A3", 2), ("F3", 2), ("D3", 2), ("Bb2", 2)], v=54, legato=0.05)
        ob.line(b0 + 24, [*TH["P4"][:-1], ("F5", 5)], v=64, legato=0.05)
        bn.line(b0 + 24, [("A3", 1.5), ("G3", 0.5), ("F3", 1), ("E3", 1), ("F3", 5)], v=56, legato=0.05)
        swell(ob, b0 - 0.1, b1=b0 + 8, lo=66, hi=84)
        swell(ob, b0 + 16, b1=b0 + 24, lo=68, hi=86)
        swell(ob, b0 + 24, b1=b0 + 34, lo=70, hi=84, peak=0.3)
        swell(bn, b0 + 8, b1=b0 + 16, lo=64, hi=80)
        swell(bn, b0 + 16, b1=b0 + 34, lo=62, hi=78, peak=0.5)

    def bounce(ctx: _PhraseContext) -> None:
        for k in range(1, 9):
            ch = A_PROG[k - 1][0][0]
            ctx.band.vcp.n(ctx.start + 4 * k, 0.5, p=bass_pitch(ch, 36), v=54)
            ctx.band.vcp.n(ctx.start + 4 * k + 2, 0.5, p=bass_pitch(ch, 36) + 7, v=46)

    phrase(
        out,
        "phrase-day-4",
        bpm=76,
        prog=A_PROG,
        lead=lead,
        extra_fn=bounce,
        bed="quarters",
        strings_level=40,
        harp_v=36,
        seats_adj={"ob": (0, 2), "bns": (0, 12)},
    )


def night1(out: Path | str) -> None:
    prog: Progression = [
        [("F", 4)],
        [("Dm", 4)],
        [("Bb", 4)],
        [("Csus", 4)],
        [("F", 4)],
        [("Bb", 4)],
        [("Gm7", 2), ("C7", 2)],
        [("Fadd9", 4)],
    ]

    def lead(band: Band, b0: float) -> None:
        cel = band.cel
        cel.line(b0, [(pitch(p) + 12 if p else None, d) for p, d in TH["P1"]], v=40, legato=0.3)
        band.hpl.line(
            b0 + 8,
            [("D5", 1), ("Bb5", 1.5), ("A5", 0.5), ("G5", 1), ("F5", 1), ("G5", 1), ("C5", 2)],
            v=44,
            legato=0.6,
        )
        cel.line(b0 + 16, [(pitch(p) + 12 if p else None, d) for p, d in TH["P3"]], v=40, legato=0.3)
        cel.line(b0 + 24, [(pitch(p) + 12 if p else None, d) for p, d in TH["P4"]], v=38, legato=0.4)
        band.glk.n(b0 + 28, 4, p="C7", v=30)
        band.glk.n(b0 + 28.02, 4, p="F6", v=28)

    def high(ctx: _PhraseContext) -> None:
        sec = ctx.band.song.clock.sec
        for p_ in ("F5", "C6"):
            ctx.band.vn.n(ctx.start, ctx.fin - ctx.start + 6, p=p_, v=70, legato=0.0)
        ctx.band.vn.env([(sec(ctx.start), 0), (sec(ctx.start + 6), 30), (sec(ctx.fin), 32), (sec(ctx.fin + 7), 0)])
        ctx.band.vn.cc(0, num=1, val=22)

    phrase(
        out,
        "phrase-night-1",
        bpm=66,
        prog=prog,
        lead=lead,
        extra_fn=high,
        ring=1.25,
        bed="rolls",
        voices=("vc", "va"),
        table={k: v[1:3] for k, v in STR.items()},
        strings_level=33,
        harp_v=34,
        seats_adj={"vn": (0, -4), "cel": (0, 4), "hpl": (0, 3)},
    )


def night2(out: Path | str) -> None:
    prog: Progression = [
        [("F", 4)],
        [("Am", 4)],
        [("Dm", 4)],
        [("Bb", 4)],
        [("Gm7", 4)],
        [("Csus", 2), ("C7", 2)],
        [("F", 4)],
    ]

    def lead(band: Band, b0: float) -> None:
        hp, cel = band.hpl, band.cel
        hp.line(b0, [("C5", 1.5), ("A5", 2.5)], v=46, legato=1.0)
        cel.line(b0 + 4, [("C6", 1), ("E6", 1), ("C6", 2)], v=36, legato=0.4)
        hp.line(b0 + 8, [("D5", 1.5), ("A5", 1.5), ("G5", 1)], v=46, legato=1.0)
        cel.line(b0 + 12, [("D6", 1), ("F6", 1), ("D6", 2)], v=36, legato=0.4)
        hp.line(b0 + 16, [("F5", 1.5), ("D6", 1.5), ("C6", 1)], v=46, legato=1.0)
        cel.line(b0 + 20, [("Bb5", 1), ("D6", 1), ("C6", 2)], v=36, legato=0.4)
        cel.line(b0 + 24, [("C6", 4)], v=34, legato=0.4)
        band.glk.n(b0 + 24, 4, p="A6", v=26)
        band.glk.n(b0 + 4, 3, p="E7", v=22)

    def soft(ctx: _PhraseContext) -> None:
        ctx.band.cel.n(ctx.fin + 1, 3, p="G6", v=28)
        ctx.band.cel.n(ctx.fin + 2.5, 3, p="C7", v=26)

    phrase(
        out,
        "phrase-night-2",
        bpm=60,
        prog=prog,
        lead=lead,
        extra_fn=soft,
        ring=1,
        bed="rolls",
        voices=("vc", "va", "vn"),
        table={k: v[1:] for k, v in STR.items()},
        strings_level=34,
        harp_v=30,
        seats_adj={"hpl": (0, 4), "cel": (0, 3)},
    )


def ruin1(out: Path | str) -> None:
    prog: Progression = [
        [("Fm", 4)],
        [("Db", 4)],
        [("Bbm", 4)],
        [("Csus", 2), ("C7", 2)],
        [("Fm", 4)],
        [("Db", 4)],
        [("Fmadd9", 4)],
    ]
    table = dict(STRM)
    table["Fmadd9"] = ("F2", "C3", "Ab3")

    def lead(band: Band, b0: float) -> None:
        ob = band.ob
        ob.line(
            b0,
            [("C5", 1), ("Ab5", 1.5), ("G5", 0.5), ("F5", 1), ("G5", 1), ("Ab5", 1), ("C6", 1.6), (None, 0.4)],
            v=56,
            legato=0.05,
        )
        ob.line(b0 + 12, [("Db5", 1), ("Bb5", 1.5), ("Ab5", 0.5), ("F5", 1), ("E5", 2), (None, 2)], v=54, legato=0.05)
        ob.line(
            b0 + 16,
            [("C5", 1), ("Ab5", 1.5), ("G5", 0.5), ("F5", 1), ("Eb5", 1), ("F5", 1), ("G5", 6)],
            v=54,
            legato=0.05,
        )
        swell(ob, b0 - 0.1, b1=b0 + 8, lo=60, hi=76)
        swell(ob, b0 + 12, b1=b0 + 16, lo=58, hi=72)
        swell(ob, b0 + 16, b1=b0 + 30, lo=60, hi=74, peak=0.35)

    def dust(ctx: _PhraseContext) -> None:
        sec = ctx.band.song.clock.sec
        notes = ["C6", "Ab5", "G5", "F6", "C6", "Eb6", "Db6", "C6", "G5", "Ab5", "F5", "C6"]
        t = sec(ctx.start + 2)
        i = 0
        while t < sec(ctx.fin + 4):
            ctx.band.cel.t(t, 1.0, p=notes[i % len(notes)], v=28 - (i % 3) * 2)
            t += 2.1 + (i % 3) * 0.7
            i += 1
        for k in range(0, 8, 2):
            ch = [[("Fm", 4.0)], *prog][k][0][0]
            ctx.band.vcp.n(ctx.start + 4 * k, 0.5, p=bass_pitch(ch, 36), v=50)

    phrase(
        out,
        "phrase-ruin-1",
        bpm=66,
        prog=prog,
        lead=lead,
        extra_fn=dust,
        ring=1.5,
        bed="quarters",
        voices=("cb", "vc", "va"),
        table=table,
        strings_level=42,
        harp_v=32,
        seats_adj={"ob": (0, 2)},
    )


PHRASE_BUILDERS = (day1, day2, day3, day4, night1, night2, ruin1)
