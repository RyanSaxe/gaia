"""Gaia's music: the announcement film's storybook chamber band and theme, written for open-ended play.

One composition, three ways to play it:
- the piece: 32 bars of 4/4 at 75 BPM in F major (102.4 s, exactly 4,915,200 samples at 48 kHz), as four stems that
  loop together: `bed` (held strings, harp and pizzicato), `melody` (clarinet, flute, oboe, solo violin), `shimmer`
  (celesta, glockenspiel, high harp, soft high violins) and `minor` (the bed in F minor, darker and sparser);
- phrases: seven short standalone pieces built from the same theme, from silence to a natural decay.

Form of the piece (bars):
  A   1-8   the theme on the clarinet over harp eighths      F  Am  Bb  Csus C | Dm  Bb  Gm7 C7 | F
  B   9-16  the answer: flute, then solo violin, then flute   Bb F/A Gm  Dm     | Bb  F/A Gm7 C7 | Csus
            climbing to a high F left open on C sus; tiptoe pizzicato
  A'  17-24 the theme on the solo violin (clarinet below), oboe, then flute and clarinet in thirds
  C   25-32 the coda: low clarinet and a far flute echo the head, harp in quarters, and a harp run up bar 32
            leads back into bar 1. The melody breathes through bars 25, 28, 30 and 31.

The minor stem follows the bed bar for bar (F -> Fm, Am -> Ab, Bb -> Bbm, Dm -> Db, Gm -> G half-diminished), and
the shimmer uses only notes each bar's major and minor chords share, so it sits over either. The melody is major:
it is not meant to sound over the minor stem.

The loop is written once, after a one-bar pre-roll, and the mixer folds everything that sounds past bar 32 back onto
bar 1, so each stem is its own steady state and loops without a seam.

Usage: compose.py OUT_DIR   (writes OUT_DIR/<song>/ MIDI, parts.json and timing.json for the loop and each phrase)
"""
import json
import sys
from pathlib import Path

from .score import THEME4, Clock, P, Part, Song, dia, extra, tr

K = 5  # F major
TH = {k: tr(THEME4[k], K) for k in THEME4}

SEATS = {"cl": [0, -0.2, 0.4, 120, -9, 1.0], "fl": [2, 0.15, 0.4, 250, -8, 1.5], "ob": [-1, 0.05, 0.4, 200, -8, 1.0],
         "bn": [-8, 0.3, 0.4, 60, -10, 0.0], "bns": [-7, 0.3, 0.4, 60, -10, 0.0],
         "cel": [-6, -0.35, 0.6, 300, -6, 1.0], "hp": [-5, -0.5, 0.6, 70, -8, 1.5], "hpl": [-5, -0.3, 0.5, 70, -8, 1.5], "glk": [-12, 0.3, 0.5, 400, -6, 0.0],
         "sv": [3, -0.15, 0.4, 200, -8, 2.5], "vn": [-2, -0.45, 0.7, 180, -9, 2.0], "va": [-4, 0.15, 0.7, 120, -9, 1.5],
         "vc": [-3, 0.35, 0.7, 50, -10, 0.0], "cb": [-9, 0.5, 0.6, 35, -12, 0.0],
         "vnp": [-9, -0.4, 0.6, 200, -10, 1.5], "vap": [-10, 0.15, 0.6, 120, -10, 1.0], "vcp": [-7, 0.35, 0.6, 50, -11, 0.0]}
PATCH = {"cl": "ClarinetSus.sfz", "fl": "gaia-FluteSusVib.sfz", "ob": "OboeSusVib.sfz", "bn": "BassoonStac.sfz",
         "bns": "BassoonSus.sfz", "cel": extra("fs-celesta"), "hp": extra("vcsl-harp"), "hpl": extra("vcsl-harp"), "glk": extra("vcsl-glock"),
         "sv": "gaia-SViolinVib.sfz", "vn": "gaia-ViolinEnsSusVib.sfz", "va": "gaia-ViolaEnsSusVib.sfz",
         "vc": "gaia-CelloEnsSusVib.sfz", "cb": "gaia-ContrabassSusVB.sfz", "vnp": "ViolinEnsPizz.sfz",
         "vap": "ViolaEnsPizz.sfz", "vcp": "CelloEnsPizz.sfz"}
LEAD = {"cl": 0.03, "fl": 0.05, "ob": 0.03, "bn": 0.01, "bns": 0.03, "cel": 0.004, "hp": 0.02, "hpl": 0.02, "glk": 0.005,
        "sv": 0.05, "vn": 0.14, "va": 0.12, "vc": 0.08, "cb": 0.06, "vnp": 0.004, "vap": 0.004, "vcp": 0.004}
CROSSFADED = ("fl", "sv", "vn", "va", "vc", "cb")  # gaia-* patches: CC1 picks the layer, CC11 is the volume

# chords: (bass pitch class name, pitch classes above the root)
CHORDS = {"F": ("F", "F", [0, 4, 7]), "Am": ("A", "A", [0, 3, 7]), "Bb": ("Bb", "Bb", [0, 4, 7]),
          "Csus": ("C", "C", [0, 5, 7, 10]), "C7": ("C", "C", [0, 4, 7, 10]), "Dm": ("D", "D", [0, 3, 7]),
          "Gm": ("G", "G", [0, 3, 7]), "Gm7": ("G", "G", [0, 3, 7, 10]), "F/A": ("A", "F", [0, 4, 7]),
          "F/C": ("C", "F", [0, 4, 7]), "Fadd9": ("F", "F", [0, 4, 7, 14]),
          "Fm": ("F", "F", [0, 3, 7]), "Ab": ("Ab", "Ab", [0, 4, 7]), "Bbm": ("Bb", "Bb", [0, 3, 7]),
          "Db": ("Db", "Db", [0, 4, 7]), "Gh7": ("G", "G", [0, 3, 6, 10]), "Fm/Ab": ("Ab", "F", [0, 3, 7]),
          "Fm/C": ("C", "F", [0, 3, 7]), "Fmadd9": ("F", "F", [0, 3, 7, 14]), "Dbmaj7": ("Db", "Db", [0, 4, 7, 11]),
          "Bbm6": ("Bb", "Bb", [0, 3, 7, 9]), "C": ("C", "C", [0, 4, 7])}
PC = {"C": 0, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "Gb": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}

# string voicings (cb, vc, va, vn), led so each voice moves by step where it can
STR = {"F": ("F2", "C3", "A3", "F4"), "Fadd9": ("F2", "C3", "A3", "G4"), "Am": ("A2", "E3", "A3", "E4"),
       "Bb": ("Bb2", "F3", "Bb3", "D4"), "Csus": ("C3", "G3", "Bb3", "F4"), "C7": ("C3", "G3", "Bb3", "E4"),
       "Dm": ("D3", "F3", "A3", "F4"), "Gm7": ("G2", "F3", "Bb3", "D4"), "Gm": ("G2", "G3", "Bb3", "D4"),
       "F/A": ("A2", "F3", "A3", "C4"), "F/C": ("C3", "F3", "A3", "C4")}
# the minor bed: lower, no violins
STRM = {"Fm": ("F2", "C3", "Ab3"), "Ab": ("Ab2", "Eb3", "C4"), "Bbm": ("Bb2", "F3", "Db4"), "Csus": ("C3", "F3", "Bb3"),
        "C7": ("C3", "G3", "E4"), "Db": ("Db3", "F3", "Ab3"), "Gh7": ("G2", "F3", "Db4"), "Fm/Ab": ("Ab2", "F3", "C4"),
        "Fm/C": ("C3", "F3", "Ab3")}
TO_MINOR = {"F": "Fm", "Fadd9": "Fm", "Am": "Ab", "Bb": "Bbm", "Csus": "Csus", "C7": "C7", "Dm": "Db", "Gm7": "Gh7",
            "Gm": "Gh7", "F/A": "Fm/Ab", "F/C": "Fm/C"}


def pcs(ch):
    _, root, iv = CHORDS[ch]
    return {(PC[root] + i) % 12 for i in iv}


def bass_pitch(ch, lo=40):
    """The chord's bass in E2..Eb3 (or from `lo`)."""
    b = PC[CHORDS[ch][0]]
    m = lo + (b - lo) % 12
    return m


def arp(ch, n=7, lo=40, top=None):
    """The bass, then chord tones rising from a fifth or so above it."""
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


class Band:
    """A song's parts, made on first use, with the house seats."""

    def __init__(self, song, prefix=""):
        self.song, self.prefix, self.parts = song, prefix, {}

    def __getattr__(self, inst):
        if inst.startswith("_") or inst not in PATCH:
            raise AttributeError(inst)
        if inst not in self.parts:
            p = self.song.part(self.prefix + inst, PATCH[inst], lead=LEAD[inst],
                               jitter=0.006 if inst in ("cel", "glk", "hp", "hpl") else 0.010)
            if inst in CROSSFADED:
                p.cc(0, 1, 34)
                p.cc(0, 11, 60)
            else:
                p.cc(0, 11, 80)
            self.parts[inst] = p
        return self.parts[inst]


PITCHCAL = json.loads((Path(__file__).resolve().parent / "pitchcal.json").read_text())
EVEN = 0.8  # how much of each pitch's measured correction to apply: some natural register contour stays
STEP = 2  # dB between gain groups


def even_out(song, seats, stems):
    """Split each part whose patch has a pitch table (calibrate.py pitches) into gain groups, so its registers play
    evenly: every note goes to the part for its correction, rounded to STEP dB, and each group gets the same CC
    curves and its own fader. Seats and stems are rewritten to match."""
    for name, part in list(song.parts.items()):
        table = PITCHCAL.get(Path(part.sfz).name)
        if not table or not part.notes:
            continue
        groups = {}
        for note in part.notes:
            k = int(round(EVEN * table.get(str(note[2]), 0.0) / STEP) * STEP)
            groups.setdefault(k, []).append(note)
        del song.parts[name]
        base = seats.pop(name)
        stem = next(g for g, ns in stems.items() if name in ns)
        stems[stem].remove(name)
        for k, notes in sorted(groups.items()):
            sub = Part(song, f"{name}_{'p' if k >= 0 else 'm'}{abs(k)}", part.sfz, lead=part.lead)
            sub.notes, sub.ccs, sub.bends = notes, list(part.ccs), list(part.bends)
            song.parts[sub.name] = sub
            seats[sub.name] = [base[0] + k] + base[1:]
            stems[stem].append(sub.name)


def swell(part, b0, b1, lo, hi, peak=0.6, num=11):
    """A breath of CC: lo at b0, hi at `peak` of the way, lo again at b1 (beats)."""
    T = part.c.sec
    bm = b0 + (b1 - b0) * peak
    part.env([(T(b0), lo), (T(bm), hi), (T(b1), lo)], num=num)


def strings(band, b0, prog, v=80, voices=("cb", "vc", "va", "vn"), table=STR, tie=True):
    """Held chords; a voice holding the same pitch into the next chord is tied over."""
    for i, inst in enumerate(voices):
        part = getattr(band, inst)
        b = b0
        cur = None
        for ch, d in prog:
            p = table[ch][i]
            if tie and cur and cur[0] == p:
                cur = (p, cur[1], cur[2] + d)
            else:
                if cur:
                    part.n(cur[1], cur[2], cur[0], v, legato=0.04)
                cur = (p, b, d)
            b += d
        if cur:
            part.n(cur[1], cur[2], cur[0], v, legato=0.04)


def harp_wave(band, b0, ch, v, beats=4, part=None):
    """Eighths up and back down the chord: bass, then four tones up, then three down."""
    hp = part or band.hp
    a = arp(ch, 5)
    order = [0, 1, 2, 3, 4, 3, 2, 1]
    for k in range(int(round(beats * 2))):
        hp.n(b0 + k * 0.5, 1.2, a[order[k % 8]], v + (6 if k % 4 == 0 else 0) - (2 if k % 2 else 0))


def harp_quarters(band, b0, ch, v, beats=4, part=None, lo=40):
    hp = part or band.hp
    a = arp(ch, 4, lo=lo)
    for k in range(int(beats)):
        hp.n(b0 + k, 1.8, a[k % 4], v + (5 if k == 0 else 0))


def roll(part, b0, pitches, v, spread=0.06, beats=2.0):
    T = part.c.sec
    for i, p in enumerate(pitches):
        part.t(T(b0) + i * spread, T(b0 + beats) - T(b0), p, v + i, jit=0.003)


# ---------------------------------------------------------------------------------------------------------------
# the piece
BPM = 75
BARS = 32
PRE = 4  # one bar of pre-roll before bar 1, so notes that lead in (strings 0.14 s early) are not clipped
TAIL = 12  # three bars after bar 32 for every release and the harp's ring; the mixer folds them onto bar 1

PROG = [
    [("F", 4)], [("Am", 4)], [("Bb", 4)], [("Csus", 2), ("C7", 2)], [("Dm", 4)], [("Bb", 4)], [("Gm7", 2), ("C7", 2)], [("F", 4)],
    [("Bb", 4)], [("F/A", 4)], [("Gm", 4)], [("Dm", 4)], [("Bb", 4)], [("F/A", 4)], [("Gm7", 2), ("C7", 2)], [("Csus", 4)],
    [("F", 4)], [("Am", 4)], [("Bb", 4)], [("Csus", 2), ("C7", 2)], [("Dm", 4)], [("Bb", 4)], [("Gm7", 2), ("C7", 2)], [("Fadd9", 4)],
    [("Bb", 4)], [("F/A", 4)], [("Gm7", 4)], [("Dm", 4)], [("Bb", 4)], [("F/C", 4)], [("Gm7", 4)], [("Csus", 2), ("C7", 2)],
]
assert len(PROG) == BARS and all(sum(d for _, d in bar) == 4 for bar in PROG)


def bb(bar, beat=0.0):
    """Beat of bar `bar` (1-based) in the render."""
    return PRE + (bar - 1) * 4 + beat


def common(bar):
    """Pitch classes every chord of the bar shares with its minor twin."""
    s = None
    for ch, _ in PROG[bar - 1]:
        both = pcs(ch) & pcs(TO_MINOR[ch])
        s = both if s is None else s & both
    return s


def near(pc_set, lo, hi, prefer=(0, 5, 7, 10)):
    """Pitches of the set between lo and hi, the preferred classes first."""
    ms = [m for m in range(P(lo), P(hi) + 1) if m % 12 in pc_set]
    return sorted(ms, key=lambda m: (prefer.index(m % 12) if m % 12 in prefer else 9, m))


def piece(out):
    total = PRE + BARS * 4 + TAIL
    clock = Clock([(0.0, total * 60 / BPM, total, 4)])
    L = BARS * 4 * 60 / BPM
    s = Song("piece", clock, {"bar1": PRE * 60 / BPM, "wrap": PRE * 60 / BPM + L, "end": total * 60 / BPM})
    T = clock.sec
    bed, mel, sh, mi = Band(s, "bed_"), Band(s, "mel_"), Band(s, "sh_"), Band(s, "min_")

    # ---- bed: strings hold the harmony throughout, softer in the coda; the pulse changes with each section
    flat = [c for bar in PROG for c in bar]
    strings(bed, bb(1), flat, v=80)
    for inst, off in (("cb", -4), ("vc", 0), ("va", -2), ("vn", -8)):
        p = getattr(bed, inst)
        pts = [(bb(1), 46), (bb(5), 50), (bb(8, 2), 46), (bb(9), 44), (bb(13), 50), (bb(16), 52), (bb(17), 48),
               (bb(21), 54), (bb(24, 2), 48), (bb(25), 44), (bb(29), 46), (bb(32), 46), (bb(33), 46)]
        p.env([(T(b), v + off) for b, v in pts])
        p.env([(T(bb(1)), 30), (T(bb(13)), 36), (T(bb(21)), 40), (T(bb(25)), 30), (T(bb(33)), 30)], num=1)
    for bar in list(range(1, 9)) + list(range(17, 25)):  # A and A': harp eighths
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            harp_wave(bed, b, ch, 40 if bar < 17 else 42, beats=d)
            b += d
    for bar in range(9, 17):  # B: a rolled chord each bar and tiptoe pizzicato
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            roll(bed.hp, b, arp(ch, 5), 38, spread=0.07, beats=d)
            for q in range(int(d)):
                if (b + q - PRE) % 2 == 0:
                    bed.vcp.n(b + q, 0.5, bass_pitch(ch, 36), 58 + (6 if q == 0 else 0))
                else:
                    top = near(pcs(ch), "D5", "A5", prefer=())[:2]
                    bed.vnp.n(b + q, 0.5, max(top), 50)
                    bed.vap.n(b + q, 0.5, max(near(pcs(ch), "F4", "C5", prefer=())), 46)
            b += d
    for bar in range(25, 33):  # the coda: harp quarters, the cello pizzicato on each downbeat
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            if bar == 32 and ch == "C7":  # the run up: back into bar 1
                for k, m in enumerate(["C4", "E4", "G4", "Bb4"]):
                    bed.hp.n(b + k * 0.5, 1.0, m, 36 + k * 2)
            else:
                harp_quarters(bed, b, ch, 38, beats=d)
            b += d
        bed.vcp.n(bb(bar), 0.5, bass_pitch(PROG[bar - 1][0][0], 36), 54)

    # ---- melody: A, the theme on the clarinet
    P4 = TH["P4"][:-1] + [("F5", 3.5)]
    mel.cl.line(bb(1), TH["P1"] + TH["P2"] + TH["P3"] + P4, lambda i, b: 60 + (5 if i in (1, 6) else 0), legato=0.05)
    for a, z in ((1, 5), (5, 9)):
        swell(mel.cl, bb(a), bb(z), 64, 82)
    # B: the answer, flute and solo violin
    fl, sv = mel.fl, mel.sv
    fl.line(bb(9), [("D5", 1), ("Bb5", 1.5), ("A5", .5), ("G5", 1), ("A5", 1), ("C6", 1), ("F5", 1.5)], 66, legato=0.05)
    swell(fl, bb(9) - 0.2, bb(10, 3.6), 58, 76)
    sv.line(bb(11), [("Bb4", 1), ("G5", 1.5), ("F5", .5), ("D5", 1), ("E5", 1), ("F5", 1), ("A4", 1.6)], 62, legato=0.05)
    swell(sv, bb(11) - 0.2, bb(12, 3.6), 62, 80)
    fl.line(bb(13), [("F5", 1), ("D6", 1.5), ("C6", .5), ("Bb5", 1), ("A5", 1), ("Bb5", 1), ("C6", 2),
                     ("Bb5", 1), ("C6", 1), ("D6", 1), ("E6", 1), ("F6", 3.4)], 68, legato=0.05)
    swell(fl, bb(13) - 0.2, bb(16, 3.4), 58, 80, peak=0.8)
    fl.env([(T(bb(16, 3.0)), 60), (T(bb(16, 3.4)), 44)])
    sv.line(bb(13), [("D5", 4), ("C5", 4), ("Bb4", 2), ("C5", 2), ("C5", 3.5)], 56, legato=0.05)
    sv.env([(T(bb(13)) - 0.2, 40), (T(bb(14)), 54), (T(bb(16)), 56), (T(bb(16, 3.5)), 38)])
    sv.env([(T(bb(10)), 34), (T(bb(11)) - 0.3, 34), (T(bb(11)), 58), (T(bb(13)) - 0.2, 58), (T(bb(13)), 38),
            (T(bb(17)) - 0.4, 38), (T(bb(17)) - 0.2, 52), (T(bb(21)), 52)], num=1)
    # A': the theme on the solo violin with the clarinet below, the oboe's P3, then flute and clarinet in thirds
    sv.line(bb(17), TH["P1"] + TH["P2"], lambda i, b: 66 + (5 if i in (1, 6) else 0), legato=0.05)
    swell(sv, bb(17) - 0.2, bb(21), 52, 74)
    mel.cl.line(bb(17), [("F4", 2), ("A4", 2), ("E4", 2), ("G4", 2), ("D4", 2), ("F4", 2), ("F4", 2), ("E4", 1.6)], 54, legato=0.05)
    mel.ob.line(bb(21), TH["P3"], lambda i, b: 60 + (5 if i in (1, 6) else 0), legato=0.05)
    swell(mel.ob, bb(21) - 0.1, bb(23), 66, 84)
    fl.line(bb(23), TH["P4"][:-1] + [("F5", 3.4)], 66, legato=0.05)
    swell(fl, bb(23) - 0.2, bb(24, 3.4), 60, 78, peak=0.35)
    third = [(dia(p, -2, K), d) for p, d in TH["P4"][:-1]] + [("A4", 3.4)]
    mel.cl.line(bb(23), third, 58, legato=0.05)
    mel.cl.env([(T(bb(17)), 60), (T(bb(21)), 62), (T(bb(23)), 68), (T(bb(24, 3.4)), 58)])
    # the coda: the head low on the clarinet, a far flute, and a pickup back into bar 1
    mel.cl.line(bb(26), [("C4", 1), ("A4", 1.5), ("G4", .5), ("F4", 1), ("G4", 1), ("A4", 1), ("F4", 1.6)], 58, legato=0.05)
    swell(mel.cl, bb(26) - 0.1, bb(27, 3.6), 60, 74, peak=0.4)
    fl.line(bb(29), [("F5", 1), ("D6", 1.5), ("C6", 1.3)], 60, legato=0.05)
    swell(fl, bb(29) - 0.2, bb(29, 3.8), 50, 66, peak=0.45)
    mel.cl.line(bb(32, 2), [("A4", 1), ("Bb4", 1)], 56, legato=0.08)
    mel.cl.env([(T(bb(32, 1.9)), 62), (T(bb(33)), 64)])

    # ---- shimmer: high violins in B and the coda, celesta and high harp twinkling on the notes major and minor share
    for bar in list(range(9, 17)) + list(range(25, 33)):
        top = near(common(bar), "F5", "D6")[0]
        sh.vn.n(bb(bar), 4, top, 70, legato=0.05)
    sh.vn.env([(T(bb(9)) - 0.3, 0), (T(bb(10)), 34), (T(bb(16)), 36), (T(bb(17)), 0)])
    sh.vn.env([(T(bb(25)) - 0.3, 0), (T(bb(26)), 32), (T(bb(32, 3)), 32), (T(bb(33)), 0)])
    sh.vn.cc(T(bb(1)), 1, 22)
    spots = [(0.5, 0), (2.5, 1), (1.5, 2), (3.0, 0), (0.0, 1), (2.0, 2), (3.5, 1), (1.0, 0)]
    for bar in range(1, BARS + 1):
        cand = near(common(bar), "C6", "C7")
        beat, which = spots[bar % len(spots)]
        sh.cel.n(bb(bar, beat), 1.5, cand[which % len(cand)], 34 - (bar % 3) * 2)
        if bar % 2 == 0:
            beat2, which2 = spots[(bar * 3 + 1) % len(spots)]
            if abs(beat2 - beat) >= 1:
                sh.cel.n(bb(bar, beat2), 1.5, cand[(which2 + 1) % len(cand)], 30)
        if bar % 4 == 1:
            sh.glk.n(bb(bar), 3, near(common(bar), "C6", "C7")[0] + 12, 34)
        if bar % 2 == 1:
            hh = near(common(bar), "C5", "C6")
            sh.hp.n(bb(bar, 2.5), 2.0, hh[0] + 12, 34)

    # ---- minor: the bed in F minor; low strings without violins, a slower harp, fewer plucks, a bassoon in B and C
    mflat = [(TO_MINOR[ch], d) for ch, d in flat]
    strings(mi, bb(1), mflat, v=80, voices=("cb", "vc", "va"), table=STRM)
    for inst, off in (("cb", -4), ("vc", 0), ("va", -2)):
        p = getattr(mi, inst)
        p.env([(T(bb(1)), 44 + off), (T(bb(9)), 42 + off), (T(bb(17)), 46 + off), (T(bb(25)), 42 + off), (T(bb(33)), 44 + off)])
        p.cc(T(bb(1)), 1, 24)
    for bar in range(1, BARS + 1):
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            mch = TO_MINOR[ch]
            if bar % 2 == 1 and bar != 32:
                harp_quarters(mi, b, mch, 34, beats=d, lo=38)
            else:
                roll(mi.hp, b, arp(mch, 3, lo=38), 32, spread=0.09, beats=d)
            b += d
        if bar % 2 == 1:
            mi.vcp.n(bb(bar), 0.5, bass_pitch(TO_MINOR[PROG[bar - 1][0][0]], 36), 52)
    for bar in list(range(9, 17)) + list(range(25, 33)):
        b = bb(bar)
        for ch, d in PROG[bar - 1]:
            mi.bns.n(b, d, P(STRM[TO_MINOR[ch]][0]) + 12, 50, legato=0.05)
            b += d
    mi.bns.env([(T(bb(9)) - 0.2, 50), (T(bb(17)), 54), (T(bb(25)), 50), (T(bb(33)), 54)])

    seats = {}
    for band in (bed, mel, sh, mi):
        for inst in band.parts:
            seats[band.prefix + inst] = list(SEATS[inst])
    seats["sh_vn"][0] -= 4
    seats["bed_hp"][0] -= 2
    seats["sh_hp"][4] += 2
    seats["min_hp"][4] += 1
    seats["min_bns"][0] += 4
    stems = {"bed": [f"bed_{i}" for i in bed.parts], "melody": [f"mel_{i}" for i in mel.parts],
             "shimmer": [f"sh_{i}" for i in sh.parts], "minor": [f"min_{i}" for i in mi.parts]}
    even_out(s, seats, stems)
    s.write(Path(out) / "piece", meta={
        "kind": "loop", "bpm": BPM, "bars": BARS, "loop_start": T(PRE), "loop_seconds": L, "key": "F major",
        "seats": seats, "reverb": {"rt": [2.4, 2.1, 1.7, 1.0], "length": 3.0}, "stems": stems})


# ---------------------------------------------------------------------------------------------------------------
# phrases: each from silence, one bar of harp and strings before the lead comes in, a last chord left to ring


def phrase(out, name, bpm, prog, lead, extra_fn=None, intro=1, ring=2, bed="eighths", strings_level=46,
           voices=("cb", "vc", "va", "vn"), table=STR, harp_v=40, seats_adj=None):
    """prog: per-bar chord lists after the intro bar (the intro bar plays the first chord); lead(band, b0) writes the
    tune from the first bar after the intro; the last chord rings for `ring` bars."""
    bars = [[(prog[0][0][0], 4)]] * intro + prog
    nb = len(bars)
    total = 4 * (nb + ring) + 4
    clock = Clock([(0.0, total * 60 / bpm, total, 4)])
    s = Song(name, clock, {"end": total * 60 / bpm})
    T = clock.sec
    band = Band(s)
    start = 0.5  # half a beat of silence before the first note
    flat = [c for bar in bars for c in bar]
    last = flat[-1][0]
    strings(band, start, flat[:-1] + [(last, flat[-1][1] + 4 * ring - 1)], v=80, voices=voices, table=table)
    end_t = T(start + 4 * (nb + ring) - 1)
    for i, inst in enumerate(voices):
        p = getattr(band, inst)
        lvl = strings_level + (-4, 0, -2, -8)[i]
        p.env([(T(start) - 0.2, 0), (T(start) + 1.6, lvl), (T(start + 4 * nb), lvl + 2), (end_t, 0)])
        p.cc(0, 1, 30)
    for k, bar in enumerate(bars):
        b = start + 4 * k
        for ch, d in bar:
            if bed == "eighths":
                harp_wave(band, b, ch, harp_v, beats=d)
            elif bed == "quarters":
                harp_quarters(band, b, ch, harp_v, beats=d)
            elif bed == "rolls":
                roll(band.hp, b, arp(ch, 6), harp_v, spread=0.09, beats=d)
            b += d
    fin = start + 4 * nb
    roll(band.hp, fin, arp(last, 7), harp_v + 4, spread=0.08, beats=4 * ring)
    lead(band, start + 4 * intro, T)
    if extra_fn:
        extra_fn(band, start, T, fin)
    seats = {inst: list(SEATS[inst]) for inst in band.parts}
    for inst, (i, dv) in (seats_adj or {}).items():
        if inst in seats:
            seats[inst][i] += dv
    stems = {"all": list(band.parts)}
    even_out(s, seats, stems)
    s.write(Path(out) / name, meta={"kind": "phrase", "bpm": bpm, "bars": nb + ring, "seats": seats,
                                    "reverb": {"rt": [2.4, 2.1, 1.7, 1.0], "length": 3.0}, "stems": stems})


A_PROG = [[("F", 4)], [("Am", 4)], [("Bb", 4)], [("Csus", 2), ("C7", 2)], [("Dm", 4)], [("Bb", 4)], [("Gm7", 2), ("C7", 2)], [("F", 4)]]


def day1(out):
    """The theme on the clarinet, whole, over harp eighths and soft strings."""
    def lead(band, b0, T):
        band.cl.line(b0, TH["P1"] + TH["P2"] + TH["P3"] + TH["P4"][:-1] + [("F5", 5)],
                     lambda i, b: 60 + (5 if i in (1, 6) else 0), legato=0.05)
        swell(band.cl, b0, b0 + 16, 64, 82)
        swell(band.cl, b0 + 16, b0 + 34, 66, 84, peak=0.45)

    def pluck(band, start, T, fin):
        for k in range(1, 9):
            band.vcp.n(start + 4 * k, 0.5, bass_pitch(A_PROG[k - 1][0][0], 36), 54)
    phrase(out, "phrase-day-1", 76, A_PROG, lead, pluck, seats_adj={"cl": (0, 2)})


def day2(out):
    """The flute's variation: the same contour, lighter, with turns, over tiptoe pizzicato and a rolled harp."""
    prog = [[("F", 4)], [("C7", 4)], [("Bb", 4)], [("Csus", 2), ("C7", 2)], [("F/A", 4)], [("Bb", 4)], [("Gm7", 2), ("C7", 2)], [("F", 4)]]

    def lead(band, b0, T):
        tune = [("C5", 1), ("A5", 1), ("G5", .5), ("A5", .5), ("F5", 1), ("G5", .5), ("A5", .5), ("Bb5", .5), ("A5", .5), ("C6", 2),
                ("Bb5", 1), ("A5", .5), ("G5", .5), ("F5", .5), ("G5", .5), ("D5", 1), ("G5", 2.5), (None, 1.5),
                ("C5", 1), ("A5", 1), ("G5", .5), ("A5", .5), ("F5", 1), ("G5", .5), ("A5", .5), ("C6", .5), ("D6", .5), ("D6", 2),
                ("C6", 1), ("Bb5", .5), ("A5", .5), ("G5", .5), ("F5", .5), ("E5", .5), ("G5", .5), ("F5", 5)]
        band.fl.line(b0, tune, 66, legato=0.04)
        swell(band.fl, b0 - 0.2, b0 + 8, 56, 76)
        swell(band.fl, b0 + 8, b0 + 16, 58, 80)
        swell(band.fl, b0 + 16, b0 + 37, 60, 82, peak=0.4)

    def tiptoe(band, start, T, fin):
        for k, bar in enumerate([[("F", 4)]] + prog):
            b = start + 4 * k
            for ch, d in bar:
                for q in range(int(d)):
                    if (b + q - start) % 2 == 0:
                        band.vcp.n(b + q, 0.5, bass_pitch(ch, 36), 56 + (6 if q == 0 else 0))
                    else:
                        band.vnp.n(b + q, 0.5, max(near(pcs(ch), "D5", "A5", prefer=())), 48)
                        band.vap.n(b + q, 0.5, max(near(pcs(ch), "F4", "C5", prefer=())), 44)
                b += d
        band.cel.n(fin + 0.5, 2, "C7", 34)
        band.cel.n(fin + 0.52, 2, "F6", 32)
    phrase(out, "phrase-day-2", 80, prog, lead, tiptoe, bed="rolls", strings_level=42, harp_v=36,
           seats_adj={"fl": (0, 2)})


def day3(out):
    """The solo violin sings the head and its sequences over the harp alone, a cello far below."""
    prog = [[("F", 4)], [("Am", 4)], [("Gm", 4)], [("Dm", 2), ("C7", 2)], [("Bb", 4)], [("F/A", 4)], [("Gm7", 2), ("C7", 2)], [("F", 4)]]

    def lead(band, b0, T):
        tune = TH["P1"] + [("Bb4", 1), ("G5", 1.5), ("F5", .5), ("D5", 1), ("E5", 1), ("F5", 1), ("G5", 1.6), (None, .4),
                           ("F5", 1), ("D6", 1.5), ("C6", .5), ("Bb5", 1), ("A5", 1), ("G5", 1), ("F5", 1.6), (None, .4),
                           ("C6", 1.5), ("Bb5", .5), ("A5", 1), ("G5", 1), ("F5", 5)]
        band.sv.line(b0, tune, lambda i, b: 66 + (5 if i in (1, 8, 15) else 0), legato=0.05)
        for a in (0, 8, 16, 24):
            swell(band.sv, b0 + a - 0.2, b0 + a + 8 + (3 if a == 24 else 0), 50, 76, peak=0.5)
    phrase(out, "phrase-day-3", 72, prog, lead, ring=1.5, voices=("vc",), table={k: (v[1],) for k, v in STR.items()},
           strings_level=44, harp_v=42, seats_adj={"vc": (0, -2), "sv": (0, 5)})


def day4(out):
    """The oboe states the head, the bassoon answers below; then the two together in tenths, landing on F."""
    def lead(band, b0, T):
        ob, bn = band.ob, band.bns
        ob.line(b0, TH["P1"], 62, legato=0.05)
        bn.line(b0 + 8, [("D3", 1), ("Bb3", 1.5), ("A3", .5), ("G3", 1), ("F3", 1), ("G3", 1), ("C3", 2)], 58, legato=0.05)
        ob.line(b0 + 16, TH["P3"], 64, legato=0.05)
        bn.line(b0 + 16, [("A3", 2), ("F3", 2), ("D3", 2), ("Bb2", 2)], 54, legato=0.05)
        ob.line(b0 + 24, TH["P4"][:-1] + [("F5", 5)], 64, legato=0.05)
        bn.line(b0 + 24, [("A3", 1.5), ("G3", .5), ("F3", 1), ("E3", 1), ("F3", 5)], 56, legato=0.05)
        swell(ob, b0 - 0.1, b0 + 8, 66, 84)
        swell(ob, b0 + 16, b0 + 24, 68, 86)
        swell(ob, b0 + 24, b0 + 34, 70, 84, peak=0.3)
        swell(bn, b0 + 8, b0 + 16, 64, 80)
        swell(bn, b0 + 16, b0 + 34, 62, 78, peak=0.5)

    def bounce(band, start, T, fin):
        for k in range(1, 9):
            ch = A_PROG[k - 1][0][0]
            band.vcp.n(start + 4 * k, 0.5, bass_pitch(ch, 36), 54)
            band.vcp.n(start + 4 * k + 2, 0.5, bass_pitch(ch, 36) + 7, 46)
    phrase(out, "phrase-day-4", 76, A_PROG, lead, bounce, bed="quarters", strings_level=40, harp_v=36,
           seats_adj={"ob": (0, 2), "bns": (0, 12)})


def night1(out):
    """Celesta and harp, slow: the head on the celesta, the harp's echo, P3 and the falling close; high violins."""
    prog = [[("F", 4)], [("Dm", 4)], [("Bb", 4)], [("Csus", 4)], [("F", 4)], [("Bb", 4)], [("Gm7", 2), ("C7", 2)], [("Fadd9", 4)]]

    def lead(band, b0, T):
        cel = band.cel
        cel.line(b0, [(P(p) + 12 if p else None, d) for p, d in TH["P1"]], 40, legato=0.3)
        band.hpl.line(b0 + 8, [("D5", 1), ("Bb5", 1.5), ("A5", .5), ("G5", 1), ("F5", 1), ("G5", 1), ("C5", 2)], 44, legato=0.6)
        cel.line(b0 + 16, [(P(p) + 12 if p else None, d) for p, d in TH["P3"]], 40, legato=0.3)
        cel.line(b0 + 24, [(P(p) + 12 if p else None, d) for p, d in TH["P4"]], 38, legato=0.4)
        band.glk.n(b0 + 28, 4, "C7", 30)
        band.glk.n(b0 + 28.02, 4, "F6", 28)

    def high(band, start, T, fin):
        for p_ in ("F5", "C6"):
            band.vn.n(start, fin - start + 6, p_, 70, legato=0.0)
        band.vn.env([(T(start), 0), (T(start + 6), 30), (T(fin), 32), (T(fin + 7), 0)])
        band.vn.cc(0, 1, 22)
    phrase(out, "phrase-night-1", 66, prog, lead, high, ring=1.25, bed="rolls", voices=("vc", "va"),
           table={k: v[1:3] for k, v in STR.items()}, strings_level=33,
           harp_v=34, seats_adj={"vn": (0, -4), "cel": (0, 4), "hpl": (0, 3)})


def night2(out):
    """The harp leads high and soft, the celesta answers each phrase a sixth above; violas and violins hold."""
    prog = [[("F", 4)], [("Am", 4)], [("Dm", 4)], [("Bb", 4)], [("Gm7", 4)], [("Csus", 2), ("C7", 2)], [("F", 4)]]

    def lead(band, b0, T):
        hp, cel = band.hpl, band.cel
        hp.line(b0, [("C5", 1.5), ("A5", 2.5)], 46, legato=1.0)
        cel.line(b0 + 4, [("C6", 1), ("E6", 1), ("C6", 2)], 36, legato=0.4)
        hp.line(b0 + 8, [("D5", 1.5), ("A5", 1.5), ("G5", 1)], 46, legato=1.0)
        cel.line(b0 + 12, [("D6", 1), ("F6", 1), ("D6", 2)], 36, legato=0.4)
        hp.line(b0 + 16, [("F5", 1.5), ("D6", 1.5), ("C6", 1)], 46, legato=1.0)
        cel.line(b0 + 20, [("Bb5", 1), ("D6", 1), ("C6", 2)], 36, legato=0.4)
        cel.line(b0 + 24, [("C6", 4)], 34, legato=0.4)
        band.glk.n(b0 + 24, 4, "A6", 26)
        band.glk.n(b0 + 4, 3, "E7", 22)

    def soft(band, start, T, fin):
        band.cel.n(fin + 1, 3, "G6", 28)
        band.cel.n(fin + 2.5, 3, "C7", 26)
    phrase(out, "phrase-night-2", 60, prog, lead, soft, ring=1, bed="rolls", voices=("vc", "va", "vn"),
           table={k: v[1:] for k, v in STR.items()}, strings_level=34, harp_v=30,
           seats_adj={"hpl": (0, 4), "cel": (0, 3)})


def ruin1(out):
    """F minor: the oboe alone on the theme's head, a minor sixth now, over low strings; celesta dust; it ends on the
    ninth over F minor, left hanging."""
    prog = [[("Fm", 4)], [("Db", 4)], [("Bbm", 4)], [("Csus", 2), ("C7", 2)], [("Fm", 4)], [("Db", 4)], [("Fmadd9", 4)]]
    table = dict(STRM)
    table["Fmadd9"] = ("F2", "C3", "Ab3")

    def lead(band, b0, T):
        ob = band.ob
        ob.line(b0, [("C5", 1), ("Ab5", 1.5), ("G5", .5), ("F5", 1), ("G5", 1), ("Ab5", 1), ("C6", 1.6), (None, .4)], 56, legato=0.05)
        ob.line(b0 + 12, [("Db5", 1), ("Bb5", 1.5), ("Ab5", .5), ("F5", 1), ("E5", 2), (None, 2)], 54, legato=0.05)
        ob.line(b0 + 16, [("C5", 1), ("Ab5", 1.5), ("G5", .5), ("F5", 1), ("Eb5", 1), ("F5", 1), ("G5", 6)], 54, legato=0.05)
        swell(ob, b0 - 0.1, b0 + 8, 60, 76)
        swell(ob, b0 + 12, b0 + 16, 58, 72)
        swell(ob, b0 + 16, b0 + 30, 60, 74, peak=0.35)

    def dust(band, start, T, fin):
        notes = ["C6", "Ab5", "G5", "F6", "C6", "Eb6", "Db6", "C6", "G5", "Ab5", "F5", "C6"]
        t = T(start + 2)
        i = 0
        while t < T(fin + 4):
            band.cel.t(t, 1.0, notes[i % len(notes)], 28 - (i % 3) * 2)
            t += 2.1 + (i % 3) * 0.7
            i += 1
        for k in range(0, 8, 2):
            ch = ([[("Fm", 4)]] + prog)[k][0][0]
            band.vcp.n(start + 4 * k, 0.5, bass_pitch(ch, 36), 50)
    phrase(out, "phrase-ruin-1", 66, prog, lead, dust, ring=1.5, bed="quarters", voices=("cb", "vc", "va"), table=table,
           strings_level=42, harp_v=32, seats_adj={"ob": (0, 2)})


def main(out):
    piece(out)
    for f in (day1, day2, day3, day4, night1, night2, ruin1):
        f(out)


if __name__ == "__main__":
    main(sys.argv[1])
