"""Cut Gaia's world sounds from CC0 field recordings into seamless Ogg Opus beds and one-shots.

Beds are loops cut from each recording's calmest, most even stretch (the reasons are beside each entry), closed with
an equal-power crossfade so the wrap is inaudible. One-shots are single events, and footsteps are sprites of single
steps laid end to end. The only cleanup is a high-pass for rumble, because the game applies its own filters and levels.

Every bed is levelled to BED_LUFS, and every one-shot to ONE_SHOT_PEAK, or lower where that would make it louder than
MAX_LUFS, so the game's gains start from one reference and nothing at unity gain is louder than a bed. The manifest
records what each file came from and measures each decoded Opus file.

Usage: world.py OUT_DIR   (fetches the recordings, then writes the Ogg files, manifest.json and CREDITS.md)
"""

import json
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

import cache
from cache import RECORDINGS, SOURCES, run_command

SR = 48000
FRAME = 960  # one 20 ms Opus frame. Loop lengths are whole frames
XFADE = 2.0  # the loop seam's equal-power crossfade, seconds
BED_LUFS = -24.0
ONE_SHOT_PEAK = -3.0  # dBFS before encoding, since Opus overshoots peaks by a fraction of a dB
PEAK_CAP = -3.0
MAX_LUFS = -24.0  # no file is louder than the beds, so nothing played at unity gain stands out
MAX_DECODED_PEAK_DBFS = -1.0
STEREO_NDIM = 2
ONSET_RISE_DB = 9
ONSET_MIN_GAP_HOPS = 44
meter = pyln.Meter(SR)


class _BedSpecRequired(TypedDict):
    name: str
    id: str
    start: float
    loop: float
    hp: int
    mono: bool
    why: str


class _BedSpec(_BedSpecRequired, total=False):
    search: float
    level_swells: bool


class _StepSpec(TypedDict):
    name: str
    id: str
    hp: int
    why: str


class _TrimSpec(TypedDict, total=False):
    over: float
    tail: float
    lead: float


class _SourceEntry(TypedDict):
    freesound_id: int
    recordist: str
    title: str
    url: str
    licence: str
    licence_url: str


class _SoundInfo(TypedDict, total=False):
    kind: str
    loop: bool
    crossfade_s: float
    span: tuple[float, float]
    highpass_hz: float
    seam_envelope_corr: float
    seam_level_step_db: float
    steps: list[dict[str, float]]
    why: str
    gain_db: float


class _ManifestFileEntry(TypedDict, total=False):
    file: str
    source: _SourceEntry
    kind: str
    loop: bool
    crossfade_s: float
    span: dict[str, float]
    highpass_hz: float
    seam_envelope_corr: float
    seam_level_step_db: float
    steps: list[dict[str, float]]
    why: str
    gain_db: float
    duration_s: float
    samples: int
    channels: int
    bitrate_kbps: int
    bytes: int
    loudness_lufs: float | None
    peak_dbfs: float
    seam: dict[str, float]


class _Manifest(TypedDict):
    sample_rate: int
    codec: str
    levels: dict[str, float | str]
    files: dict[str, _ManifestFileEntry]


@dataclass(frozen=True)
class _SoundJob:
    name: str
    fid: str
    kbps: int
    make: Callable[[], tuple[np.ndarray, _SoundInfo]]
    why: str | None = None


def db(v: float | np.ndarray) -> np.ndarray:
    return np.asarray(10 ** (np.asarray(v) / 20))


def load(fid: str, *, start: float = 0.0, dur: float | None = None, mono: bool = False) -> np.ndarray:
    args = ["-v", "error", "-ss", f"{start:.4f}", "-i", str(RECORDINGS / f"fs{fid}.ogg")]
    if dur:
        args.extend(["-t", f"{dur:.4f}"])
    args.extend(["-ac", "2", "-ar", str(SR), "-f", "f32le", "-"])
    raw = run_command("ffmpeg", args, nice=True, capture_output=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    return x.mean(axis=1) if mono else x


def hp(x: np.ndarray, hz: float, *, order: int = 2) -> np.ndarray:
    return np.asarray(signal.sosfilt(signal.butter(order, hz, "highpass", fs=SR, output="sos"), x, axis=0))


def filtered(fid: str, *, start: float, dur: float, mono: bool, hz: float) -> np.ndarray:
    pre = min(1.0, start)
    x = hp(load(fid, start=start - pre, dur=dur + pre, mono=mono), hz)
    return x[round(pre * SR) :][: round(dur * SR)]


def envelope(x: np.ndarray, hop: int = 240) -> np.ndarray:
    m = x if x.ndim == 1 else x.mean(axis=1)
    return np.sqrt((m[: len(m) // hop * hop].reshape(-1, hop) ** 2).mean(axis=1) + 1e-12)


def lufs(x: np.ndarray) -> float | None:
    return float(meter.integrated_loudness(x)) if len(x) >= int(0.4 * SR) else None


def peak_db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.abs(x).max() + 1e-12))


# ---------------------------------------------------------------- beds

BEDS: list[_BedSpec] = [
    {
        "name": "wind",
        "id": "176249",
        "start": 39.0,
        "loop": 60.0,
        "hp": 70,
        "mono": False,
        "why": (
            "39-101 s: the steady middle of the recording. The first 8 s hold handling knocks and a loud gust, "
            "the last 40 s thin out; this stretch keeps its 1 s level within about 2 dB with no loud second."
        ),
    },
    {
        "name": "gusts",
        "id": "853991",
        "start": 49.0,
        "loop": 60.0,
        "hp": 70,
        "mono": False,
        "why": (
            "49-111 s: the calmer first third (from 120 s on the gusts get brighter and louder); the most even "
            "minute, its loudest second 3 dB over its median and no rumble or handling."
        ),
    },
    {
        "name": "leaves",
        "id": "523389",
        "start": 74.0,
        "loop": 45.6,
        "search": 0.5,
        "hp": 80,
        "mono": False,
        "level_swells": True,
        "why": (
            "74-121.6 s: the longest even stretch, after the swells at 40-45 s and 63-68 s. It holds one swell "
            "(114-120 s, 7 dB over the rest), so swells are levelled to within 3 dB of the median; the seam "
            "joins two calm stretches."
        ),
    },
    {
        "name": "stream",
        "id": "220528",
        "start": 70.0,
        "loop": 60.0,
        "hp": 60,
        "mono": False,
        "why": (
            "70-132 s: the stream is even throughout (1 s level spread 0.3 dB); this minute has the least "
            "low-frequency movement, past the fade-in at the start."
        ),
    },
    {
        "name": "mill",
        "id": "724851",
        "start": 2.5,
        "loop": 56.0,
        "search": 2.0,
        "hp": 90,
        "mono": True,
        "why": (
            "2.5-61.5 s: the whole wheel recording after its first 2 s, which carry low rumble; mixed to mono "
            "and the loop length chosen to land on the wheel's rhythm."
        ),
    },
    {
        "name": "birds",
        "id": "571891",
        "start": 1036.0,
        "loop": 60.0,
        "hp": 90,
        "mono": False,
        "why": (
            "1036-1098 s: of the 18 minutes, the stretch with the fewest and softest near peaks (99.9th "
            "percentile 10 ms level 24 dB over the median, against 26-27 dB elsewhere), song spread evenly, "
            "and none of the regular low calls heard at 20-130 s, 470-560 s and 850-950 s."
        ),
    },
    {
        "name": "birds-evening",
        "id": "627734",
        "start": 9.0,
        "loop": 59.0,
        "hp": 90,
        "mono": False,
        "why": (
            "fs627734 rather than fs521558: fs521558 has a bird close to the microphone (peaks 42 dB over its "
            "median, against 27 dB) and low rumble. 9-70 s skips the loud phrase in the first 8 s; the "
            "blackbird sings a phrase every 6-7 s over a quiet chorus."
        ),
    },
    {
        "name": "crickets",
        "id": "751466",
        "start": 60.0,
        "loop": 60.0,
        "search": 6.0,
        "hp": 90,
        "mono": False,
        "why": (
            "60-122 s: the recording is even throughout (1 s level spread 0.6 dB); the loop length is chosen "
            "so the chirp train lines up across the seam."
        ),
    },
]


def level_swells(x: np.ndarray, *, over: float = 3.0, window: float = 1.5) -> np.ndarray:
    """Lower swells rising more than `over` dB above the stretch median.

    Uses a slow gain following a `window`-second level so a gust in the leaves doesn't come round again as a
    recognisable event.
    """
    hop = 480
    e = envelope(x, hop) ** 2
    k = int(window * SR / hop)
    lv = 10 * np.log10(np.convolve(np.pad(e, (k, k), mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k])
    g = -np.maximum(0.0, lv - np.median(lv) - over)
    g = np.interp(np.arange(len(x)), np.arange(len(g)) * hop + hop / 2, g)
    return x * db(g)[:, None] if x.ndim == STEREO_NDIM else x * db(g)


def seam_length(x: np.ndarray, loop_n: int, *, search: float = 1.5) -> tuple[float, int, float, float]:
    xf = int(XFADE * SR)
    head = envelope(x[:xf], 120)
    best: tuple[float, int, float, float] | None = None
    for n in range(loop_n - int(search * SR) // FRAME * FRAME, loop_n + int(search * SR) // FRAME * FRAME + 1, FRAME):
        if n + xf > len(x):
            break
        tail = envelope(x[n : n + xf], 120)
        c = float(np.corrcoef(np.log(head), np.log(tail))[0, 1])
        step = float(abs(20 * np.log10(np.sqrt((head**2).mean() / (tail**2).mean()))))
        score = c - 0.15 * step
        if best is None or score > best[0]:
            best = (score, n, c, step)
    if best is None:
        sys.exit(f"no valid seam found near {loop_n} frames (buffer has {len(x)} frames)")
    return best


def make_bed(b: _BedSpec) -> tuple[np.ndarray, _SoundInfo]:
    xf = int(XFADE * SR)
    loop_n = round(b["loop"] * SR / FRAME) * FRAME
    search = b.get("search", 1.5)
    x = filtered(b["id"], start=b["start"], dur=b["loop"] + XFADE + search + 0.1, mono=b["mono"], hz=b["hp"])
    if b.get("level_swells"):
        x = level_swells(x)
    _, n, corr, step = seam_length(x, loop_n, search=search)
    t = np.linspace(0, 1, xf, endpoint=False) + 0.5 / xf
    fin, fout = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
    if x.ndim == STEREO_NDIM:
        fin, fout = fin[:, None], fout[:, None]
    # y[i] = x[xf + i]. Its last xf samples fade out while x[0:xf] fades in, so y wraps onto x[xf] exactly.
    y = x[xf : xf + n].copy()
    y[n - xf :] = x[n : n + xf] * fout + x[:xf] * fin
    measured = lufs(y)
    if measured is None:
        sys.exit(f"{b['name']}: bed is too short to measure LUFS ({len(y)} samples)")
    gain = min(BED_LUFS - measured, PEAK_CAP - peak_db(y))
    y = y * db(gain)
    span = (b["start"], round(b["start"] + (n + xf) / SR, 3))
    info: _SoundInfo = {
        "kind": "bed",
        "loop": True,
        "crossfade_s": XFADE,
        "span": span,
        "highpass_hz": b["hp"],
        "seam_envelope_corr": round(corr, 3),
        "seam_level_step_db": round(step, 2),
        "why": b["why"],
        "gain_db": round(gain, 1),
    }
    return y, info


# ---------------------------------------------------------------- footsteps


def grains(fid: str, maxlen: float = 0.42) -> list[tuple[float, np.ndarray]]:
    src = load(fid, mono=True)
    hop = 240
    e = 20 * np.log10(np.sqrt((src[: len(src) // hop * hop].reshape(-1, hop) ** 2).mean(axis=1) + 1e-12))
    floor = np.percentile(e, 20)
    on: list[int] = []
    for i in range(5, len(e)):
        if e[i] - e[i - 5] > ONSET_RISE_DB and e[i] > floor + 12 and (not on or i - on[-1] > ONSET_MIN_GAP_HOPS):
            on.append(i)
    out: list[tuple[float, np.ndarray]] = []
    for k, i in enumerate(on):
        s0 = i * hop - int(0.015 * SR)
        s1 = min(i * hop + int(maxlen * SR), (on[k + 1] * hop if k + 1 < len(on) else len(src)) - int(0.01 * SR))
        if s0 < 0 or s1 - s0 < int(0.2 * SR):
            continue
        g = src[s0:s1].copy()
        out.append((s0 / SR, g))
    return out


STEPS: list[_StepSpec] = [
    {"name": "steps-grass", "id": "685286", "hp": 90, "why": "footsteps through grass"},
    {"name": "steps-dry", "id": "377323", "hp": 90, "why": "footsteps through dry grass"},
    {"name": "steps-wood", "id": "397670", "hp": 70, "why": "footsteps on a wooden bridge"},
]


def make_steps(s: _StepSpec, *, most: int = 16, least: int = 10) -> tuple[np.ndarray, _SoundInfo]:
    gs: list[tuple[float, float, np.ndarray]] = []
    for t0, raw_grain in grains(s["id"]):
        g = hp(raw_grain, s["hp"])
        g[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
        g[-int(0.07 * SR) :] *= np.linspace(1, 0, int(0.07 * SR)) ** 2
        gs.append((t0, peak_db(g), g))
    found = len(gs)
    # middling loudness: drop the loudest and quietest, then keep those nearest the median peak
    lo, hi = np.percentile([p for _, p, _ in gs], (20, 85))
    mid = [r for r in gs if lo <= r[1] <= hi]
    med = float(np.median([p for _, p, _ in mid]))
    mid = sorted(sorted(mid, key=lambda r: abs(r[1] - med))[:most], key=lambda r: r[0])
    if len(mid) < least:
        sys.exit(f"{s['name']}: only {len(mid)} middling steps of {found}")
    gap = np.zeros(int(0.05 * SR))
    parts: list[np.ndarray] = []
    steps: list[dict[str, float]] = []
    pos = 0
    for t0, _p, raw_step in mid:
        levelled = raw_step * db(ONE_SHOT_PEAK - peak_db(raw_step))
        if parts:
            parts.append(gap)
            pos += len(gap)
        steps.append(
            {"start": round(pos / SR, 5), "length": round(len(levelled) / SR, 5), "source_start": round(t0, 3)}
        )
        parts.append(levelled)
        pos += len(levelled)
    y = np.concatenate(parts)
    measured = lufs(y)
    if measured is not None:
        y = y * db(min(0.0, MAX_LUFS - measured))
    span = (round(mid[0][0], 3), round(mid[-1][0] + len(mid[-1][2]) / SR, 3))
    info: _SoundInfo = {
        "kind": "sprite",
        "loop": False,
        "span": span,
        "highpass_hz": s["hp"],
        "steps": steps,
        "why": f"{s['why']}: {len(mid)} middling steps of {found} found by onset",
    }
    return y, info


# ---------------------------------------------------------------- one-shots


def trim_quiet(
    x: np.ndarray,
    start: float,
    *,
    over: float = 6.0,
    tail: float = 0.35,
    lead: float = 0.05,
) -> tuple[np.ndarray, float]:
    e = 20 * np.log10(envelope(x, 240))
    floor = np.percentile(e, 15)
    loud = np.where(e > floor + over)[0]
    a = max(0, int(loud[0]) * 240 - int(lead * SR))
    b = min(len(x), int(loud[-1]) * 240 + 240 + int(tail * SR))
    return x[a:b], start + a / SR


def shape(x: np.ndarray, *, fade_in: float = 0.004, fade_out: float = 0.08) -> np.ndarray:
    x = x.copy()
    i, o = int(fade_in * SR), int(fade_out * SR)
    x[:i] *= np.linspace(0, 1, i)
    x[-o:] *= np.linspace(1, 0, o) ** 2
    return x


def one_shot(
    fid: str,
    *,
    start: float,
    dur: float,
    hz: float = 90,
    trim: _TrimSpec | None = None,
    fade_in: float = 0.004,
    fade_out: float = 0.08,
    gain: float = 1.0,
) -> tuple[np.ndarray, _SoundInfo]:
    x = filtered(fid, start=start, dur=dur, mono=True, hz=hz)
    t0 = start
    if trim:
        x, t0 = trim_quiet(x, start, **trim)
    x = shape(x, fade_in=fade_in, fade_out=fade_out)
    x = x * db(ONE_SHOT_PEAK - peak_db(x))
    measured = lufs(x)
    x = x * db(min(0.0, MAX_LUFS - measured) if measured is not None else 0.0) * gain
    info: _SoundInfo = {
        "kind": "one-shot",
        "loop": False,
        "span": (round(t0, 3), round(t0 + len(x) / SR, 3)),
        "highpass_hz": hz,
    }
    return x, info


ONE_SHOTS: list[_SoundJob] = [
    _SoundJob(
        name="book-open",
        fid="433862",
        kbps=48,
        make=lambda: one_shot("433862", start=0.0, dur=1.5, hz=90, fade_out=0.12),
        why="the book's opening, its first 1.5 s, as the film used it",
    ),
    _SoundJob(
        name="book-shut",
        fid="433862",
        kbps=48,
        make=lambda: one_shot("433862", start=0.0, dur=1.5, hz=90, fade_out=0.12, gain=0.8),
        why=(
            "the opening sound at 0.8 gain, as the film did: the recording's three slams (36.9, 38.6, 40.8 s) are "
            "bangs, 2-5 ms attacks, crest 26-28 dB, centroid 2.3-3.6 kHz, 15-25 dB above the soft opening"
        ),
    ),
    _SoundJob(
        name="page-turn",
        fid="856497",
        kbps=48,
        make=lambda: one_shot(
            "856497",
            start=0.0,
            dur=3.18,
            hz=90,
            trim={"over": 8.0, "tail": 0.15, "lead": 0.03},
            fade_in=0.01,
            fade_out=0.1,
        ),
        why=(
            "the whole recording, trimmed, as the film used it; it holds two sounds 1.5 s apart (about 0.15-0.6 s "
            "and 2.05-2.85 s into the file), so the game may play only the first"
        ),
    ),
    _SoundJob(
        name="riffle",
        fid="433862",
        kbps=48,
        make=lambda: one_shot("433862", start=28.6, dur=3.6, hz=90, fade_in=0.05, fade_out=0.05),
        why="pages riffling, 3.6 s from 28.6 s, as the film used it",
    ),
]


# ---------------------------------------------------------------- encode, measure, write


def encode(out: Path, name: str, *, y: np.ndarray, kbps: int) -> Path:
    """Encode audio array y to a bitexact Ogg Opus file under out.

    Bitexact gives the Ogg stream a fixed serial number and leaves the version out of its tags, so the same audio
    always makes the same bytes.
    """
    path = out / f"{name}.ogg"
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, y.astype(np.float32), SR, subtype="FLOAT")
        run_command(
            "ffmpeg",
            [
                "-v",
                "error",
                "-y",
                "-threads",
                "1",
                "-i",
                tmp.name,
                "-c:a",
                "libopus",
                "-b:a",
                f"{kbps}k",
                "-ar",
                str(SR),
                "-application",
                "audio",
                "-map_metadata",
                "-1",
                "-fflags",
                "+bitexact",
                "-flags:a",
                "+bitexact",
                str(path),
            ],
            nice=True,
        )
    return path


def decode(path: Path) -> np.ndarray:
    ch = int(
        run_command(
            "ffprobe",
            ["-v", "error", "-show_entries", "stream=channels", "-of", "csv=p=0", str(path)],
            capture_output=True,
        )
        .stdout.decode()
        .strip()
    )
    raw = run_command(
        "ffmpeg",
        ["-v", "error", "-i", str(path), "-ar", str(SR), "-f", "f32le", "-"],
        nice=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).astype(np.float64)


def seam_check(d: np.ndarray) -> dict[str, float]:
    m = d.mean(axis=1)
    k = int(0.1 * SR)

    def r(a: np.ndarray) -> float:
        return float(20 * np.log10(np.sqrt((a**2).mean()) + 1e-12))

    jumps = np.abs(np.diff(d, axis=0)).max(axis=1)
    wrap = float(np.abs(d[0] - d[-1]).max())
    one = SR
    secs = [r(m[i : i + one]) for i in range(0, len(m) - one, one)]
    tenths = np.array([r(m[i : i + k]) for i in range(0, len(m) - k, k)])
    steps100 = np.abs(np.diff(tenths))
    seam100 = abs(r(m[:k]) - r(m[-k:]))
    return {
        "rms_last_100ms_db": round(r(m[-k:]), 2),
        "rms_first_100ms_db": round(r(m[:k]), 2),
        "rms_step_db": round(r(m[:k]) - r(m[-k:]), 2),
        "typical_100ms_step_db": round(float(np.median(steps100)), 2),
        "rms_step_percentile": round(float((steps100 < seam100).mean() * 100), 1),
        "level_step_1s_db": round(r(m[:one]) - r(m[-one:]), 2),
        "typical_1s_step_db": round(float(np.median(np.abs(np.diff(secs)))), 2),
        "wrap_jump": round(wrap, 5),
        "median_jump": round(float(np.median(jumps)), 5),
        "p999_jump": round(float(np.percentile(jumps, 99.9)), 5),
        "wrap_jump_percentile": round(float((jumps < wrap).mean() * 100), 1),
    }


def source(fid: str) -> _SourceEntry:
    m = SOURCES["recordings"][fid]
    return {
        "freesound_id": int(fid),
        "recordist": m["recordist"],
        "title": m["title"],
        "url": m["url"],
        "licence": SOURCES["licence"]["name"],
        "licence_url": SOURCES["licence"]["url"],
    }


def _copy_optional_fields(entry: _ManifestFileEntry, info: _SoundInfo) -> None:
    if "crossfade_s" in info:
        entry["crossfade_s"] = info["crossfade_s"]
    if "seam_envelope_corr" in info:
        entry["seam_envelope_corr"] = info["seam_envelope_corr"]
    if "seam_level_step_db" in info:
        entry["seam_level_step_db"] = info["seam_level_step_db"]
    if "gain_db" in info:
        entry["gain_db"] = info["gain_db"]
    if "steps" in info:
        entry["steps"] = info["steps"]


def _build_manifest_entry(
    job: _SoundJob,
    path: Path,
    *,
    y: np.ndarray,
    d: np.ndarray,
    info: _SoundInfo,
) -> _ManifestFileEntry:
    measured_lufs = lufs(d)
    span_start, span_end = info["span"]
    entry: _ManifestFileEntry = {
        "file": path.name,
        "source": source(job.fid),
        "kind": info["kind"],
        "loop": info["loop"],
        "span": {"start": span_start, "end": span_end},
        "highpass_hz": info["highpass_hz"],
        "why": info["why"],
        "duration_s": round(len(d) / SR, 5),
        "samples": len(d),
        "channels": int(d.shape[1]),
        "bitrate_kbps": job.kbps,
        "bytes": path.stat().st_size,
        "loudness_lufs": None if measured_lufs is None else round(measured_lufs, 1),
        "peak_dbfs": round(peak_db(d), 2),
    }
    _copy_optional_fields(entry, info)
    if len(d) != len(y):
        sys.exit(f"{job.name}: decoded {len(d)} samples, wrote {len(y)}")
    if entry["peak_dbfs"] >= MAX_DECODED_PEAK_DBFS:
        sys.exit(f"{job.name}: peak {entry['peak_dbfs']} dBFS")
    if info["loop"]:
        entry["seam"] = seam_check(d)
    return entry


def main(out: Path | str) -> None:
    cache.world()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    manifest: _Manifest = {
        "sample_rate": SR,
        "codec": "Ogg Opus",
        "levels": {
            "beds_lufs": BED_LUFS,
            "one_shots_peak_dbfs": ONE_SHOT_PEAK,
            "max_lufs": MAX_LUFS,
            "note": (
                "beds are levelled to one loudness; one-shots to one peak, lowered where that would "
                "be louder than the beds (every step in a sprite keeps the same peak); book-shut is "
                "book-open at 0.8 gain. The game sets each layer's level. A loop's length is exact: "
                "loop it over its whole buffer (samples / sample_rate)."
            ),
        },
        "files": {},
    }
    jobs: list[_SoundJob] = [
        *(_SoundJob(name=b["name"], fid=b["id"], kbps=64, make=lambda b=b: make_bed(b)) for b in BEDS),
        *(_SoundJob(name=s["name"], fid=s["id"], kbps=48, make=lambda s=s: make_steps(s)) for s in STEPS),
        *ONE_SHOTS,
    ]
    for job in jobs:
        y, info = job.make()
        if job.why:
            info["why"] = job.why
        path = encode(out, job.name, y=y, kbps=job.kbps)
        d = decode(path)
        entry = _build_manifest_entry(job, path, y=y, d=d, info=info)
        manifest["files"][path.stem] = entry
        lufs_val = entry["loudness_lufs"] if entry["loudness_lufs"] is not None else float("nan")
        seam_str = f"  seam {entry['seam']}" if info["loop"] else ""
        print(
            f"{path.name:20s} {entry['duration_s']:7.2f}s {entry['channels']}ch "
            f"{lufs_val:6.1f} LUFS peak {entry['peak_dbfs']:6.2f} {entry['bytes'] / 1024:6.0f} KB{seam_str}",
            flush=True,
        )
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    write_credits(out, manifest)


def write_credits(out: Path, manifest: _Manifest) -> None:
    uses: dict[int, tuple[_SourceEntry, list[str]]] = {}
    for e in manifest["files"].values():
        src = e["source"]
        uses.setdefault(src["freesound_id"], (src, []))[1].append(e["file"])
    lines = [
        "# World sound credits",
        "",
        (
            "Every world sound is a field or foley recording from [Freesound](https://freesound.org), released under "
            "[Creative Commons 0 (CC0 1.0)](https://creativecommons.org/publicdomain/zero/1.0/): free for any use, "
            "with no attribution required. They are the recordings Gaia's announcement film used, cut into seamless "
            "loops (a 2 s equal-power crossfade at each seam) and single sounds, high-passed against rumble, and "
            "encoded as Ogg Opus by [`tools/sound/world.py`](../../../../tools/sound/world.py) (`pnpm sound world`). "
            "`manifest.json` gives each file's source, the span of it that was cut, and its loudness."
        ),
        "",
        "| Recording | Recordist | Source | Licence | Files |",
        "| --- | --- | --- | --- | --- |",
    ]
    for s, files in uses.values():
        lines.append(
            f"| {s['title']} | {s['recordist']} | {s['url']} | CC0 1.0 | {', '.join(f'`{f}`' for f in files)} |"
        )
    (out / "CREDITS.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
