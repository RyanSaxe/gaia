"""The SFZ patches the score plays that the sample libraries don't ship, written into the cache.

- gaia-*.sfz, beside VSCO 2 CE's own: its held strings and flute with every dynamic layer of a key range playing at
  once, crossfaded on CC1 (the mod wheel) as an orchestral mock-up does, so a held note can swell. The vanilla patches
  pick a layer by velocity. CC11 stays the expression (volume) control, which sfizz applies by default.
- vcsl-harp.sfz, vcsl-glock.sfz and fs-celesta.sfz, in the cache's patches/: VCSL's concert harp and soft
  glockenspiel, and the clean, fully decaying notes of a Freesound celesta's middle octave. Each sample is measured
  (pitch and peak) so the patch tunes and levels it, and the celesta's notes are converted to WAV with their lead-in
  silence skipped.
"""

import re
from collections.abc import Iterable, Mapping
from pathlib import Path

import numpy as np
import soundfile as sf

from cache import CELESTA, PATCHES, VCSL, VSCO, run_command

SR = 48000
WIDTH = 18  # CC1 steps over which two neighbouring layers crossfade
MIDI_MAX = 127
MIN_MEASURE_SEGMENT = 4096
FUNDAMENTAL_MIN_HZ = 60
FUNDAMENTAL_MAX_HZ = 6000
MAX_PITCH_DEVIATION = 0.6
CELESTA_MIN_KEY = 57
SUSTAINS = ["FluteSusVib", "SViolinVib", "ViolinEnsSusVib", "ViolaEnsSusVib", "CelloEnsSusVib", "ContrabassSusVB"]
NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
RANGE = {"vcsl-harp": (24, 103), "vcsl-glock": (79, 108), "fs-celesta": (57, 108)}  # each one's playable keys
CELESTA_NOTES = {420489: 69, 420488: 71, 420493: 75, 420491: 76, 420495: 77, 420498: 80}  # A4..G#5, tuned +10c

RegionOpcodes = dict[str, str | int | float]


class _InvalidNoteNameError(ValueError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Invalid note name: {name!r}")


def write_if_changed(path: Path, text: str, *, encoding: str = "utf-8") -> None:
    if not path.exists() or path.read_text(encoding=encoding) != text:
        path.write_text(text, encoding=encoding)


def parse(text: str) -> list[tuple[str, dict[str, str]]]:
    text = re.sub(r"//[^\n]*", "", text)
    items: list[tuple[str, dict[str, str]]] = []
    cur: tuple[str, dict[str, str]] | None = None
    for m in re.finditer(r"<(\w+)>|(\w+)=(.*?)(?=\s+\w+=|\s*<|\s*\n|\s*$)", text, flags=re.DOTALL):
        if m.group(1):
            cur = (m.group(1), {})
            items.append(cur)
        elif cur is not None:
            cur[1][m.group(2)] = m.group(3).strip()
    return items


def crossfaded(src: Path, dst: Path) -> None:
    items = parse(src.read_text(encoding="latin-1"))
    regions = [o for h, o in items if h == "region"]
    groups: dict[tuple[str | None, str | None], list[dict[str, str]]] = {}
    for r in regions:
        k = (r.get("lokey", r.get("key")), r.get("hikey", r.get("key")))
        groups.setdefault(k, []).append(r)
    for rs in groups.values():
        for r in rs:
            lo, hi = int(r.get("lovel", 0)), int(r.get("hivel", MIDI_MAX))
            r["lovel"], r["hivel"] = "0", str(MIDI_MAX)
            if lo > 0:
                r["xfin_locc1"] = str(max(0, lo - WIDTH))
                r["xfin_hicc1"] = str(min(MIDI_MAX, lo + WIDTH))
            if hi < MIDI_MAX:
                r["xfout_locc1"] = str(max(0, hi + 1 - WIDTH))
                r["xfout_hicc1"] = str(min(MIDI_MAX, hi + 1 + WIDTH))
            r["xf_cccurve"] = "power"
            r["amp_veltrack"] = "0"
            # louder as well as brighter as CC1 rises: -8 dB at 0, +4 dB at 127
            r["volume"] = str(float(r.get("volume", 0)) - 8)
            r["volume_oncc1"] = "12"
    out: list[str] = []
    for h, o in items:
        out.append(f"<{h}>")
        out.extend(f"{k}={v}" for k, v in o.items())
        out.append("")
    write_if_changed(dst, "\n".join(out), encoding="latin-1")


def midi(name: str) -> int:
    m = re.match(r"([A-G])(#|b)?(-?\d)", name)
    if m is None:
        raise _InvalidNoteNameError(name)
    accidental = 1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0
    return NAMES[m.group(1)] + accidental + 12 * (int(m.group(3)) + 1)


def measure(path: Path) -> tuple[float, float, float]:
    x, sr = sf.read(path, always_2d=True)
    m = x.mean(axis=1)
    pk = float(np.abs(m).max())
    on = int(np.argmax(np.abs(m) > pk * 0.1))
    seg = m[on + int(0.05 * sr) : on + int(0.5 * sr)]
    if len(seg) < MIN_MEASURE_SEGMENT:
        seg = m[on : on + 8192]
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n=1 << 17))
    fr = np.fft.rfftfreq(1 << 17, 1 / sr)
    sel = (fr > FUNDAMENTAL_MIN_HZ) & (fr < FUNDAMENTAL_MAX_HZ)
    f0 = float(fr[sel][np.argmax(sp[sel])])
    return float(20 * np.log10(pk + 1e-12)), on / sr, float(69 + 12 * np.log2(f0 / 440))


def spans(centres: Iterable[int]) -> dict[int, tuple[int, int]]:
    cs = sorted(centres)
    out: dict[int, tuple[int, int]] = {}
    for i, c in enumerate(cs):
        lo = 0 if i == 0 else (cs[i - 1] + c) // 2 + 1
        hi = MIDI_MAX if i == len(cs) - 1 else (c + cs[i + 1]) // 2
        out[c] = (lo, hi)
    return out


def write_patch(name: str, path: Path, *, glob: Mapping[str, str], regions: list[RegionOpcodes]) -> None:
    if name in RANGE:
        lo, hi = RANGE[name]
        kept: list[RegionOpcodes] = []
        for r in regions:
            if "lokey" in r and "hikey" in r:
                lokey = max(int(r["lokey"]), lo)
                hikey = min(int(r["hikey"]), hi)
                r["lokey"], r["hikey"] = lokey, hikey
                if lokey <= hikey:
                    kept.append(r)
            else:
                kept.append(r)
        regions = kept
    lines = [
        f"// {name}: generated by tools/sound/music/patches.py",
        "<control>",
        f"default_path={path}/",
        "",
        "<global>",
        *(f"{k}={v}" for k, v in glob.items()),
        "",
    ]
    for r in regions:
        lines.append("<region>")
        lines.extend(f"{k}={v}" for k, v in r.items())
        lines.append("")
    write_if_changed(PATCHES / f"{name}.sfz", "\n".join(lines))


def pitched(
    root: Path,
    pat: str,
    *,
    layers: Mapping[str, tuple[int, int, float]],
    shift: int = 0,
) -> list[RegionOpcodes]:
    by_note: dict[int, list[tuple[str, Path]]] = {}
    for f in sorted(root.glob("*.wav")):
        m = re.search(pat, f.name)
        if not m or m.group(2) not in layers:
            continue
        by_note.setdefault(midi(m.group(1)) + shift, []).append((m.group(2), f))
    rng = spans(by_note)
    regions: list[RegionOpcodes] = []
    for c, items in sorted(by_note.items()):
        k_lo, k_hi = rng[c]
        for layer, f in items:
            pk, _on, f0 = measure(f)
            # a note sampled at one dynamic covers all
            lv, hv = (0, MIDI_MAX) if len(items) == 1 else layers[layer][:2]
            tune = round((c - f0) * 100) if abs(f0 - c) < MAX_PITCH_DEVIATION else 0
            regions.append(
                {
                    "sample": f.name,
                    "lokey": k_lo,
                    "hikey": k_hi,
                    "pitch_keycenter": c,
                    "lovel": lv,
                    "hivel": hv,
                    "tune": tune,
                    "volume": round(-12.0 - pk + layers[layer][2], 1),
                }
            )
    return regions


def write() -> None:
    for name in SUSTAINS:
        crossfaded(VSCO / f"{name}.sfz", VSCO / f"gaia-{name}.sfz")
    PATCHES.mkdir(parents=True, exist_ok=True)

    harp = VCSL / "Chordophones/Composite Chordophones/Concert Harp"
    write_patch(
        "vcsl-harp",
        harp,
        glob={"ampeg_release": "4", "amp_veltrack": "70"},
        regions=pitched(
            harp,
            r"KSHarp_([A-G]#?\d)_(mf|f|p|mp)\d",
            layers={"mp": (0, 80, -4), "p": (0, 80, -4), "mf": (0, 92, -4), "f": (93, MIDI_MAX, 0)},
        ),
    )

    # VCSL names its glockenspiel's files with middle C as C3, so its notes sit an octave above their names (measured)
    glock = VCSL / "Idiophones/Struck Idiophones/Glockenspiel"
    write_patch(
        "vcsl-glock",
        glock,
        glob={"ampeg_release": "4", "amp_veltrack": "70"},
        regions=pitched(
            glock,
            r"glock_soft_([A-G]#?\d)_(\d+)",
            layers=dict.fromkeys(("01", "02", "03"), (0, MIDI_MAX, 0)),
            shift=12,
        ),
    )

    wav = PATCHES / "wav"
    wav.mkdir(exist_ok=True)
    rng = spans(CELESTA_NOTES.values())
    regions: list[RegionOpcodes] = []
    for sid, c in CELESTA_NOTES.items():
        dst = wav / f"celesta-{sid}.wav"
        if not dst.exists():
            run_command(
                "ffmpeg",
                [
                    "-v",
                    "error",
                    "-y",
                    "-i",
                    str(CELESTA / f"fs{sid}.ogg"),
                    "-ar",
                    str(SR),
                    "-c:a",
                    "pcm_s24le",
                    "-fflags",
                    "+bitexact",
                    str(dst),
                ],
            )
        pk, on, f0 = measure(dst)
        lo, hi = rng[c]
        regions.append(
            {
                "sample": dst.name,
                "lokey": max(lo, CELESTA_MIN_KEY),
                "hikey": hi,
                "pitch_keycenter": c,
                "offset": max(0, int((on - 0.004) * SR)),
                "tune": round((c - f0) * 100),
                "volume": round(-12 - pk, 1),
            }
        )
    write_patch("fs-celesta", wav, glob={"ampeg_release": "1.2", "amp_veltrack": "75"}, regions=regions)
