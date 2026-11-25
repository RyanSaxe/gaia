"""Gaia's music: the announcement film's storybook chamber band and theme, written for open-ended play.

One composition, three ways to play it:
- the piece: 32 bars of 4/4 at 75 BPM in F major (102.4 s, exactly 4,915,200 samples at 48 kHz), as four stems that
  loop together: `bed` (held strings, harp and pizzicato), `melody` (clarinet, flute, oboe, solo violin), `shimmer`
  (celesta, glockenspiel, high harp, soft high violins) and `minor` (the bed in F minor, darker and sparser).
- phrases: seven short standalone pieces built from the same theme (in `music/phrases.py`), from silence to decay.

Form of the piece (bars):
  A   1-8   the theme on the clarinet over harp eighths      F  Am  Bb  Csus C | Dm  Bb  Gm7 C7 | F
  B   9-16  the answer: flute, then solo violin, then flute   Bb F/A Gm  Dm     | Bb  F/A Gm7 C7 | Csus
            climbing to a high F left open on C sus, over tiptoe pizzicato
  A'  17-24 the theme on the solo violin (clarinet below), oboe, then flute and clarinet in thirds
  C   25-32 the coda: low clarinet and a far flute echo the head, harp in quarters, and a harp run up bar 32
            leads back into bar 1. The melody breathes through bars 25, 28, 30 and 31.

The minor stem follows the bed bar for bar (F -> Fm, Am -> Ab, Bb -> Bbm, Dm -> Db, Gm -> G half-diminished), and
the shimmer uses only notes each bar's major and minor chords share, so it fits over either. The melody is major,
so it is not meant to sound over the minor stem.

The loop is written once, after a one-bar pre-roll, and the mixer folds everything that sounds past bar 32 back onto
bar 1, so each stem is its own steady state and loops without a seam.

Usage: compose.py OUT_DIR   (writes OUT_DIR/<song>/ MIDI, parts.json and timing.json for the loop and each phrase)
"""

import sys
from pathlib import Path

from music.band import (
    SEATS,
    STRM,
    TH,
    TO_MINOR,
    Band,
    K,
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
from music.phrases import PHRASE_BUILDERS
from music.score import Clock, Part, PitchSpec, Song, dia, pitch

BPM = 75
BARS = 32
BEATS_PER_BAR = 4
SECTION_A_PRIME_BAR = 17
LAST_BAR = 32
PRE = 4  # one bar of pre-roll before bar 1, so notes that lead in (strings 0.14 s early) are not clipped
TAIL = 12  # three bars after bar 32 for every release and the harp's ring, which the mixer folds onto bar 1

PROG: Progression = [
    [("F", 4)],
    [("Am", 4)],
    [("Bb", 4)],
    [("Csus", 2), ("C7", 2)],
    [("Dm", 4)],
    [("Bb", 4)],
    [("Gm7", 2), ("C7", 2)],
    [("F", 4)],
    [("Bb", 4)],
    [("F/A", 4)],
    [("Gm", 4)],
    [("Dm", 4)],
    [("Bb", 4)],
    [("F/A", 4)],
    [("Gm7", 2), ("C7", 2)],
    [("Csus", 4)],
    [("F", 4)],
    [("Am", 4)],
    [("Bb", 4)],
    [("Csus", 2), ("C7", 2)],
    [("Dm", 4)],
    [("Bb", 4)],
    [("Gm7", 2), ("C7", 2)],
    [("Fadd9", 4)],
    [("Bb", 4)],
    [("F/A", 4)],
    [("Gm7", 4)],
    [("Dm", 4)],
    [("Bb", 4)],
    [("F/C", 4)],
    [("Gm7", 4)],
    [("Csus", 2), ("C7", 2)],
]


class _InvalidProgressionError(ValueError):
    def __init__(self) -> None:
        super().__init__("PROG must have BARS bars of BEATS_PER_BAR beats each")


if len(PROG) != BARS or not all(sum(d for _, d in bar) == BEATS_PER_BAR for bar in PROG):
    raise _InvalidProgressionError


def bb(bar: int, beat: float = 0.0) -> float:
    return PRE + (bar - 1) * 4 + beat


def common(bar: int) -> set[int]:
    s: set[int] | None = None
    for ch, _ in PROG[bar - 1]:
        both = pcs(ch) & pcs(TO_MINOR[ch])
        s = both if s is None else s & both
    return s if s is not None else set()


def _compose_bed_b(bed: Band) -> None:
    for bar in range(9, 17):  # B: a rolled chord each bar and tiptoe pizzicato
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            roll(bed.hp, b, pitches=arp(ch, n=5), v=38, spread=0.07, beats=d)
            for q in range(int(d)):
                if (b + q - PRE) % 2 == 0:
                    bed.vcp.n(b + q, 0.5, p=bass_pitch(ch, 36), v=58 + (6 if q == 0 else 0))
                else:
                    top = near(pcs(ch), lo="D5", hi="A5", prefer=())[:2]
                    bed.vnp.n(b + q, 0.5, p=max(top), v=50)
                    bed.vap.n(b + q, 0.5, p=max(near(pcs(ch), lo="F4", hi="C5", prefer=())), v=46)
            b += d


def _compose_bed_coda(bed: Band) -> None:
    for bar in range(25, 33):  # the coda: harp quarters, the cello pizzicato on each downbeat
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            if bar == LAST_BAR and ch == "C7":  # the run up: back into bar 1
                for k, m in enumerate(["C4", "E4", "G4", "Bb4"]):
                    bed.hp.n(b + k * 0.5, 1.0, p=m, v=36 + k * 2)
            else:
                harp_quarters(bed, b, ch=ch, v=38, beats=d)
            b += d
        bed.vcp.n(bb(bar), 0.5, p=bass_pitch(PROG[bar - 1][0][0], 36), v=54)


def _compose_piece_bed(bed: Band, clock: Clock, *, flat: list[tuple[str, float]]) -> None:
    sec = clock.sec
    strings(bed, bb(1), prog=flat, v=80)
    pts = [
        (bb(1), 46),
        (bb(5), 50),
        (bb(8, 2), 46),
        (bb(9), 44),
        (bb(13), 50),
        (bb(16), 52),
        (bb(17), 48),
        (bb(21), 54),
        (bb(24, 2), 48),
        (bb(25), 44),
        (bb(29), 46),
        (bb(32), 46),
        (bb(33), 46),
    ]
    for inst, off in (("cb", -4), ("vc", 0), ("va", -2), ("vn", -8)):
        p: Part = getattr(bed, inst)
        p.env([(sec(b), v + off) for b, v in pts])
        p.env([(sec(bb(1)), 30), (sec(bb(13)), 36), (sec(bb(21)), 40), (sec(bb(25)), 30), (sec(bb(33)), 30)], num=1)
    for bar in [*range(1, 9), *range(17, 25)]:  # A and A': harp eighths
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            harp_wave(bed, b, ch=ch, v=40 if bar < SECTION_A_PRIME_BAR else 42, beats=d)
            b += d
    _compose_bed_b(bed)
    _compose_bed_coda(bed)


def _compose_piece_melody(mel: Band, clock: Clock) -> None:
    sec = clock.sec
    # A: the theme on the clarinet
    p4 = [*TH["P4"][:-1], ("F5", 3.5)]
    mel.cl.line(bb(1), TH["P1"] + TH["P2"] + TH["P3"] + p4, v=lambda i, _b: 60 + (5 if i in (1, 6) else 0), legato=0.05)
    for a, z in ((1, 5), (5, 9)):
        swell(mel.cl, bb(a), b1=bb(z), lo=64, hi=82)
    # B: the answer, flute and solo violin
    fl, sv = mel.fl, mel.sv
    fl.line(
        bb(9), [("D5", 1), ("Bb5", 1.5), ("A5", 0.5), ("G5", 1), ("A5", 1), ("C6", 1), ("F5", 1.5)], v=66, legato=0.05
    )
    swell(fl, bb(9) - 0.2, b1=bb(10, 3.6), lo=58, hi=76)
    sv.line(
        bb(11), [("Bb4", 1), ("G5", 1.5), ("F5", 0.5), ("D5", 1), ("E5", 1), ("F5", 1), ("A4", 1.6)], v=62, legato=0.05
    )
    swell(sv, bb(11) - 0.2, b1=bb(12, 3.6), lo=62, hi=80)
    fl.line(
        bb(13),
        [
            ("F5", 1),
            ("D6", 1.5),
            ("C6", 0.5),
            ("Bb5", 1),
            ("A5", 1),
            ("Bb5", 1),
            ("C6", 2),
            ("Bb5", 1),
            ("C6", 1),
            ("D6", 1),
            ("E6", 1),
            ("F6", 3.4),
        ],
        v=68,
        legato=0.05,
    )
    swell(fl, bb(13) - 0.2, b1=bb(16, 3.4), lo=58, hi=80, peak=0.8)
    fl.env([(sec(bb(16, 3.0)), 60), (sec(bb(16, 3.4)), 44)])
    sv.line(bb(13), [("D5", 4), ("C5", 4), ("Bb4", 2), ("C5", 2), ("C5", 3.5)], v=56, legato=0.05)
    sv.env([(sec(bb(13)) - 0.2, 40), (sec(bb(14)), 54), (sec(bb(16)), 56), (sec(bb(16, 3.5)), 38)])
    sv.env(
        [
            (sec(bb(10)), 34),
            (sec(bb(11)) - 0.3, 34),
            (sec(bb(11)), 58),
            (sec(bb(13)) - 0.2, 58),
            (sec(bb(13)), 38),
            (sec(bb(17)) - 0.4, 38),
            (sec(bb(17)) - 0.2, 52),
            (sec(bb(21)), 52),
        ],
        num=1,
    )
    # A': the theme on the solo violin with the clarinet below, the oboe's P3, then flute and clarinet in thirds
    sv.line(bb(17), TH["P1"] + TH["P2"], v=lambda i, _b: 66 + (5 if i in (1, 6) else 0), legato=0.05)
    swell(sv, bb(17) - 0.2, b1=bb(21), lo=52, hi=74)
    mel.cl.line(
        bb(17),
        [("F4", 2), ("A4", 2), ("E4", 2), ("G4", 2), ("D4", 2), ("F4", 2), ("F4", 2), ("E4", 1.6)],
        v=54,
        legato=0.05,
    )
    mel.ob.line(bb(21), TH["P3"], v=lambda i, _b: 60 + (5 if i in (1, 6) else 0), legato=0.05)
    swell(mel.ob, bb(21) - 0.1, b1=bb(23), lo=66, hi=84)
    fl.line(bb(23), [*TH["P4"][:-1], ("F5", 3.4)], v=66, legato=0.05)
    swell(fl, bb(23) - 0.2, b1=bb(24, 3.4), lo=60, hi=78, peak=0.35)
    third: list[tuple[PitchSpec | None, float]] = [
        (dia(p, -2, tonic_pc=K) if p is not None else None, d) for p, d in TH["P4"][:-1]
    ]
    third.append(("A4", 3.4))
    mel.cl.line(bb(23), third, v=58, legato=0.05)
    mel.cl.env([(sec(bb(17)), 60), (sec(bb(21)), 62), (sec(bb(23)), 68), (sec(bb(24, 3.4)), 58)])
    # the coda: the head low on the clarinet, a far flute, and a pickup back into bar 1
    mel.cl.line(
        bb(26), [("C4", 1), ("A4", 1.5), ("G4", 0.5), ("F4", 1), ("G4", 1), ("A4", 1), ("F4", 1.6)], v=58, legato=0.05
    )
    swell(mel.cl, bb(26) - 0.1, b1=bb(27, 3.6), lo=60, hi=74, peak=0.4)
    fl.line(bb(29), [("F5", 1), ("D6", 1.5), ("C6", 1.3)], v=60, legato=0.05)
    swell(fl, bb(29) - 0.2, b1=bb(29, 3.8), lo=50, hi=66, peak=0.45)
    mel.cl.line(bb(32, 2), [("A4", 1), ("Bb4", 1)], v=56, legato=0.08)
    mel.cl.env([(sec(bb(32, 1.9)), 62), (sec(bb(33)), 64)])


def _compose_piece_shimmer(sh: Band, clock: Clock) -> None:
    sec = clock.sec
    for bar in [*range(9, 17), *range(25, 33)]:
        top = near(common(bar), lo="F5", hi="D6")[0]
        sh.vn.n(bb(bar), 4, p=top, v=70, legato=0.05)
    sh.vn.env([(sec(bb(9)) - 0.3, 0), (sec(bb(10)), 34), (sec(bb(16)), 36), (sec(bb(17)), 0)])
    sh.vn.env([(sec(bb(25)) - 0.3, 0), (sec(bb(26)), 32), (sec(bb(32, 3)), 32), (sec(bb(33)), 0)])
    sh.vn.cc(sec(bb(1)), num=1, val=22)
    spots = [(0.5, 0), (2.5, 1), (1.5, 2), (3.0, 0), (0.0, 1), (2.0, 2), (3.5, 1), (1.0, 0)]
    for bar in range(1, BARS + 1):
        cand = near(common(bar), lo="C6", hi="C7")
        beat, which = spots[bar % len(spots)]
        sh.cel.n(bb(bar, beat), 1.5, p=cand[which % len(cand)], v=34 - (bar % 3) * 2)
        if bar % 2 == 0:
            beat2, which2 = spots[(bar * 3 + 1) % len(spots)]
            if abs(beat2 - beat) >= 1:
                sh.cel.n(bb(bar, beat2), 1.5, p=cand[(which2 + 1) % len(cand)], v=30)
        if bar % 4 == 1:
            sh.glk.n(bb(bar), 3, p=near(common(bar), lo="C6", hi="C7")[0] + 12, v=34)
        if bar % 2 == 1:
            hh = near(common(bar), lo="C5", hi="C6")
            sh.hp.n(bb(bar, 2.5), 2.0, p=hh[0] + 12, v=34)


def _compose_minor_harp_and_pizz(mi: Band) -> None:
    for bar in range(1, BARS + 1):
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            mch = TO_MINOR[ch]
            if bar % 2 == 1 and bar != LAST_BAR:
                harp_quarters(mi, b, ch=mch, v=34, beats=d, lo=38)
            else:
                roll(mi.hp, b, pitches=arp(mch, n=3, lo=38), v=32, spread=0.09, beats=d)
            b += d
        if bar % 2 == 1:
            mi.vcp.n(bb(bar), 0.5, p=bass_pitch(TO_MINOR[PROG[bar - 1][0][0]], 36), v=52)


def _compose_piece_minor(mi: Band, clock: Clock, *, flat: list[tuple[str, float]]) -> None:
    # the bed in F minor: low strings without violins, a slower harp, fewer plucks, a bassoon in B and C
    sec = clock.sec
    mflat = [(TO_MINOR[ch], d) for ch, d in flat]
    strings(mi, bb(1), prog=mflat, v=80, voices=("cb", "vc", "va"), table=STRM)
    for inst, off in (("cb", -4), ("vc", 0), ("va", -2)):
        p: Part = getattr(mi, inst)
        p.env(
            [
                (sec(bb(1)), 44 + off),
                (sec(bb(9)), 42 + off),
                (sec(bb(17)), 46 + off),
                (sec(bb(25)), 42 + off),
                (sec(bb(33)), 44 + off),
            ]
        )
        p.cc(sec(bb(1)), num=1, val=24)
    _compose_minor_harp_and_pizz(mi)
    for bar in [*range(9, 17), *range(25, 33)]:
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            mi.bns.n(b, d, p=pitch(STRM[TO_MINOR[ch]][0]) + 12, v=50, legato=0.05)
            b += d
    mi.bns.env([(sec(bb(9)) - 0.2, 50), (sec(bb(17)), 54), (sec(bb(25)), 50), (sec(bb(33)), 54)])


def piece(out: Path | str) -> None:
    total = PRE + BARS * 4 + TAIL
    clock = Clock([(0.0, total * 60 / BPM, total, 4)])
    loop_seconds = BARS * 4 * 60 / BPM
    s = Song(
        "piece",
        clock,
        markers={"bar1": PRE * 60 / BPM, "wrap": PRE * 60 / BPM + loop_seconds, "end": total * 60 / BPM},
    )
    bed, mel, sh, mi = Band(s, "bed_"), Band(s, "mel_"), Band(s, "sh_"), Band(s, "min_")
    flat = [c for bar in PROG for c in bar]
    _compose_piece_bed(bed, clock, flat=flat)
    _compose_piece_melody(mel, clock)
    _compose_piece_shimmer(sh, clock)
    _compose_piece_minor(mi, clock, flat=flat)

    seats: dict[str, list[float]] = {}
    for band in (bed, mel, sh, mi):
        for inst in band.parts:
            seats[band.prefix + inst] = list(SEATS[inst])
    seats["sh_vn"][0] -= 4
    seats["bed_hp"][0] -= 2
    seats["sh_hp"][4] += 2
    seats["min_hp"][4] += 1
    seats["min_bns"][0] += 4
    stems = {
        "bed": [f"bed_{i}" for i in bed.parts],
        "melody": [f"mel_{i}" for i in mel.parts],
        "shimmer": [f"sh_{i}" for i in sh.parts],
        "minor": [f"min_{i}" for i in mi.parts],
    }
    even_out(s, seats, stems=stems)
    s.write(
        Path(out) / "piece",
        meta={
            "kind": "loop",
            "bpm": BPM,
            "bars": BARS,
            "loop_start": clock.sec(PRE),
            "loop_seconds": loop_seconds,
            "key": "F major",
            "seats": seats,
            "reverb": {"rt": [2.4, 2.1, 1.7, 1.0], "length": 3.0},
            "stems": stems,
        },
    )


def main(out: Path | str) -> None:
    piece(out)
    for build_phrase in PHRASE_BUILDERS:
        build_phrase(out)


if __name__ == "__main__":
    main(sys.argv[1])
