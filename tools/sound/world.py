"""Cut Gaia's world sounds from the CC0 field recordings Gaia's announcement film used: seamless beds and one-shots,
as Ogg Opus.

Beds are loops cut from each recording's calmest, most even stretch (the reasons are beside each entry), closed with
an equal-power crossfade so the wrap is inaudible. One-shots are single events; footsteps are sprites of single steps
laid end to end. Only gentle cleanup is applied (a high-pass for rumble); the game applies its own filters and levels.

Every bed is levelled to BED_LUFS; every one-shot to ONE_SHOT_PEAK, or lower where that would make it louder than
MAX_LUFS, so the game's gains start from one reference and nothing at unity gain is louder than a bed. The manifest
records what each file came from and measures each decoded Opus file.

Usage: world.py OUT_DIR   (fetches the recordings, then writes the Ogg files, manifest.json and CREDITS.md)
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

import cache
from cache import RECORDINGS, SOURCES

SR = 48000
FRAME = 960            # one 20 ms Opus frame; loop lengths are whole frames
XFADE = 2.0            # the loop seam's equal-power crossfade, seconds
BED_LUFS = -24.0
ONE_SHOT_PEAK = -3.0   # dBFS before encoding; Opus overshoots peaks by a fraction of a dB
PEAK_CAP = -3.0
MAX_LUFS = -24.0       # no file is louder than the beds, so nothing played at unity gain stands out
meter = pyln.Meter(SR)


def db(v):
    return 10 ** (np.asarray(v) / 20)


def load(fid, start=0.0, dur=None, mono=False):
    args = ["nice", "-n", "10", "ffmpeg", "-v", "error", "-ss", f"{start:.4f}", "-i", str(RECORDINGS / f"fs{fid}.ogg")]
    args += (["-t", f"{dur:.4f}"] if dur else []) + ["-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, np.float32).reshape(-1, 2).astype(np.float64)
    return x.mean(axis=1) if mono else x


def hp(x, hz, order=2):
    return signal.sosfilt(signal.butter(order, hz, "highpass", fs=SR, output="sos"), x, axis=0)


def filtered(fid, start, dur, mono, hz):
    """The stretch [start, start+dur), filtered with a second of pre-roll so the filter has settled at its first sample."""
    pre = min(1.0, start)
    x = hp(load(fid, start - pre, dur + pre, mono), hz)
    return x[int(round(pre * SR)):][: int(round(dur * SR))]


def envelope(x, hop=240):
    m = x if x.ndim == 1 else x.mean(axis=1)
    return np.sqrt((m[: len(m) // hop * hop].reshape(-1, hop) ** 2).mean(axis=1) + 1e-12)


def lufs(x):
    """Integrated loudness; None for a sound shorter than one 400 ms gating block."""
    return meter.integrated_loudness(x) if len(x) >= int(0.4 * SR) else None


def peak_db(x):
    return 20 * np.log10(np.abs(x).max() + 1e-12)


# ---------------------------------------------------------------- beds

BEDS = [
    dict(name="wind", id="176249", start=39.0, loop=60.0, hp=70, mono=False,
         why="39-101 s: the steady middle of the recording. The first 8 s hold handling knocks and a loud gust, "
             "the last 40 s thin out; this stretch keeps its 1 s level within about 2 dB with no loud second."),
    dict(name="gusts", id="853991", start=49.0, loop=60.0, hp=70, mono=False,
         why="49-111 s: the calmer first third (from 120 s on the gusts get brighter and louder); the most even "
             "minute, its loudest second 3 dB over its median and no rumble or handling."),
    dict(name="leaves", id="523389", start=74.0, loop=45.6, search=0.5, hp=80, mono=False, level_swells=True,
         why="74-121.6 s: the longest even stretch, after the swells at 40-45 s and 63-68 s. It holds one swell "
             "(114-120 s, 7 dB over the rest), so swells are levelled to within 3 dB of the median; the seam "
             "joins two calm stretches."),
    dict(name="stream", id="220528", start=70.0, loop=60.0, hp=60, mono=False,
         why="70-132 s: the stream is even throughout (1 s level spread 0.3 dB); this minute has the least "
             "low-frequency movement, past the fade-in at the start."),
    dict(name="mill", id="724851", start=2.5, loop=56.0, search=2.0, hp=90, mono=True,
         why="2.5-61.5 s: the whole wheel recording after its first 2 s, which carry low rumble; mixed to mono "
             "and the loop length chosen to land on the wheel's rhythm."),
    dict(name="birds", id="571891", start=1036.0, loop=60.0, hp=90, mono=False,
         why="1036-1098 s: of the 18 minutes, the stretch with the fewest and softest near peaks (99.9th "
             "percentile 10 ms level 24 dB over the median, against 26-27 dB elsewhere), song spread evenly, "
             "and none of the regular low calls heard at 20-130 s, 470-560 s and 850-950 s."),
    dict(name="birds-evening", id="627734", start=9.0, loop=59.0, hp=90, mono=False,
         why="fs627734 rather than fs521558: fs521558 has a bird close to the microphone (peaks 42 dB over its "
             "median, against 27 dB) and low rumble. 9-70 s skips the loud phrase in the first 8 s; the "
             "blackbird sings a phrase every 6-7 s over a quiet chorus."),
    dict(name="crickets", id="751466", start=60.0, loop=60.0, search=6.0, hp=90, mono=False,
         why="60-122 s: the recording is even throughout (1 s level spread 0.6 dB); the loop length is chosen "
             "so the chirp train lines up across the seam."),
]


def level_swells(x, over=3.0, window=1.5):
    """Lower only the swells that rise more than `over` dB above the stretch's median, by a slow gain that follows
    a `window`-second level, so a gust in the leaves doesn't come round again as a recognisable event."""
    hop = 480
    e = envelope(x, hop) ** 2
    k = int(window * SR / hop)
    lv = 10 * np.log10(np.convolve(np.pad(e, (k, k), mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k])
    g = -np.maximum(0.0, lv - np.median(lv) - over)
    g = np.interp(np.arange(len(x)), np.arange(len(g)) * hop + hop / 2, g)
    return x * db(g)[:, None] if x.ndim == 2 else x * db(g)


def seam_length(x, loop_n, search=1.5):
    """The loop length, in whole Opus frames within `search` s of `loop_n`, whose crossfade joins the most alike
    stretches: envelopes in step (the crickets' chirps, the wheel's turn) and levels matched."""
    xf = int(XFADE * SR)
    head = envelope(x[:xf], 120)
    best = None
    for n in range(loop_n - int(search * SR) // FRAME * FRAME, loop_n + int(search * SR) // FRAME * FRAME + 1, FRAME):
        if n + xf > len(x):
            break
        tail = envelope(x[n:n + xf], 120)
        c = np.corrcoef(np.log(head), np.log(tail))[0, 1]
        step = abs(20 * np.log10(np.sqrt((head ** 2).mean() / (tail ** 2).mean())))
        score = c - 0.15 * step
        if best is None or score > best[0]:
            best = (score, n, c, step)
    return best


def make_bed(b):
    xf = int(XFADE * SR)
    loop_n = int(round(b["loop"] * SR / FRAME)) * FRAME
    x = filtered(b["id"], b["start"], b["loop"] + XFADE + b.get("search", 1.5) + 0.1, b["mono"], b["hp"])
    if b.get("level_swells"):
        x = level_swells(x)
    _, n, corr, step = seam_length(x, loop_n, b.get("search", 1.5))
    t = np.linspace(0, 1, xf, endpoint=False) + 0.5 / xf
    fin, fout = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
    if x.ndim == 2:
        fin, fout = fin[:, None], fout[:, None]
    # y[i] = x[xf + i]; its last xf samples fade out while x[0:xf] fades in, so y wraps onto x[xf] exactly.
    y = x[xf:xf + n].copy()
    y[n - xf:] = x[n:n + xf] * fout + x[:xf] * fin
    gain = BED_LUFS - lufs(y)
    gain = min(gain, PEAK_CAP - peak_db(y))
    y = y * db(gain)
    span = (b["start"], round(b["start"] + (n + xf) / SR, 3))
    return y, dict(kind="bed", loop=True, crossfade_s=XFADE, span=span, highpass_hz=b["hp"],
                   seam_envelope_corr=round(float(corr), 3), seam_level_step_db=round(float(step), 2),
                   why=b["why"], gain_db=round(float(gain), 1))


# ---------------------------------------------------------------- footsteps

def grains(fid, maxlen=0.42):
    """Single steps by onset, as the film's grains(): each from 15 ms before its onset to at most 0.42 s,
    a 4 ms fade-in and a 70 ms squared fade-out. Returns (source start s, peak dB, grain)."""
    src = load(fid, mono=True)
    hop = 240
    e = 20 * np.log10(np.sqrt((src[: len(src) // hop * hop].reshape(-1, hop) ** 2).mean(axis=1) + 1e-12))
    floor = np.percentile(e, 20)
    on = []
    for i in range(5, len(e)):
        if e[i] - e[i - 5] > 9 and e[i] > floor + 12 and (not on or i - on[-1] > 44):
            on.append(i)
    out = []
    for k, i in enumerate(on):
        s0 = i * hop - int(0.015 * SR)
        s1 = min(i * hop + int(maxlen * SR), (on[k + 1] * hop if k + 1 < len(on) else len(src)) - int(0.01 * SR))
        if s0 < 0 or s1 - s0 < int(0.2 * SR):
            continue
        g = src[s0:s1].copy()
        out.append((s0 / SR, g))
    return out


STEPS = [
    dict(name="steps-grass", id="685286", hp=90, why="footsteps through grass"),
    dict(name="steps-dry", id="377323", hp=90, why="footsteps through dry grass"),
    dict(name="steps-wood", id="397670", hp=70, why="footsteps on a wooden bridge"),
]


def make_steps(s, most=16, least=10):
    gs = []
    for t0, g in grains(s["id"]):
        g = hp(g, s["hp"])
        g[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
        g[-int(0.07 * SR):] *= np.linspace(1, 0, int(0.07 * SR)) ** 2
        gs.append((t0, peak_db(g), g))
    found = len(gs)
    # middling loudness: drop the loudest and quietest, then keep those nearest the median peak
    lo, hi = np.percentile([p for _, p, _ in gs], (20, 85))
    mid = [r for r in gs if lo <= r[1] <= hi]
    med = np.median([p for _, p, _ in mid])
    mid = sorted(sorted(mid, key=lambda r: abs(r[1] - med))[:most], key=lambda r: r[0])
    assert len(mid) >= least, f"{s['name']}: only {len(mid)} middling steps of {found}"
    gap = np.zeros(int(0.05 * SR))
    parts, steps, pos = [], [], 0
    for t0, p, g in mid:
        g = g * db(ONE_SHOT_PEAK - peak_db(g))
        if parts:
            parts.append(gap)
            pos += len(gap)
        steps.append(dict(start=round(pos / SR, 5), length=round(len(g) / SR, 5), source_start=round(t0, 3)))
        parts.append(g)
        pos += len(g)
    y = np.concatenate(parts)
    y = y * db(min(0.0, MAX_LUFS - lufs(y)))
    span = (round(mid[0][0], 3), round(mid[-1][0] + len(mid[-1][2]) / SR, 3))
    return y, dict(kind="sprite", loop=False, span=span, highpass_hz=s["hp"], steps=steps,
                   why=f"{s['why']}: {len(mid)} middling steps of {found} found by onset")


# ---------------------------------------------------------------- one-shots

def trim_quiet(x, start, over=6.0, tail=0.35, lead=0.05):
    """From just before the event's first rise over the floor to its decay back to the floor, plus `tail`."""
    e = 20 * np.log10(envelope(x, 240))
    floor = np.percentile(e, 15)
    loud = np.where(e > floor + over)[0]
    a = max(0, loud[0] * 240 - int(lead * SR))
    b = min(len(x), loud[-1] * 240 + 240 + int(tail * SR))
    return x[a:b], start + a / SR


def shape(x, fade_in=0.004, fade_out=0.08):
    x = x.copy()
    i, o = int(fade_in * SR), int(fade_out * SR)
    x[:i] *= np.linspace(0, 1, i)
    x[-o:] *= np.linspace(1, 0, o) ** 2
    return x


def one_shot(fid, start, dur, hz=90, trim=None, fade_in=0.004, fade_out=0.08, gain=1.0):
    x = filtered(fid, start, dur, True, hz)
    t0 = start
    if trim:
        x, t0 = trim_quiet(x, start, **trim)
    x = shape(x, fade_in, fade_out)
    x = x * db(ONE_SHOT_PEAK - peak_db(x))
    x = x * db(min(0.0, MAX_LUFS - lufs(x)) if lufs(x) is not None else 0.0) * gain
    return x, dict(kind="one-shot", loop=False, span=(round(t0, 3), round(t0 + len(x) / SR, 3)), highpass_hz=hz)


ONE_SHOTS = [
    ("book-open", "433862", lambda: one_shot("433862", 0.0, 1.5, 90, fade_out=0.12),
     "the book's opening, its first 1.5 s, as the film used it"),
    ("book-shut", "433862", lambda: one_shot("433862", 0.0, 1.5, 90, fade_out=0.12, gain=0.8),
     "the opening sound at 0.8 gain, as the film did: the recording's three slams (36.9, 38.6, 40.8 s) are "
     "bangs, 2-5 ms attacks, crest 26-28 dB, centroid 2.3-3.6 kHz, 15-25 dB above the soft opening"),
    ("page-turn", "856497", lambda: one_shot("856497", 0.0, 3.18, 90, trim=dict(over=8.0, tail=0.15, lead=0.03),
                                             fade_in=0.01, fade_out=0.1),
     "the whole recording, trimmed, as the film used it; it holds two sounds 1.5 s apart (about 0.15-0.6 s "
     "and 2.05-2.85 s into the file), so the game may play only the first"),
    ("riffle", "433862", lambda: one_shot("433862", 28.6, 3.6, 90, fade_in=0.05, fade_out=0.05),
     "pages riffling, 3.6 s from 28.6 s, as the film used it"),
]


# ---------------------------------------------------------------- encode, measure, write

def encode(out, name, y, kbps):
    """bitexact gives the Ogg stream a fixed serial number and leaves the version out of its tags, so the same audio
    always makes the same bytes."""
    path = out / f"{name}.ogg"
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, y.astype(np.float32), SR, subtype="FLOAT")
        subprocess.run(["nice", "-n", "10", "ffmpeg", "-v", "error", "-y", "-threads", "1", "-i", tmp.name,
                        "-c:a", "libopus", "-b:a", f"{kbps}k", "-ar", str(SR), "-application", "audio",
                        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(path)], check=True)
    return path


def decode(path):
    ch = int(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=channels", "-of", "csv=p=0", str(path)],
                            capture_output=True, text=True, check=True).stdout.strip())
    raw = subprocess.run(["nice", "-n", "10", "ffmpeg", "-v", "error", "-i", str(path), "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).astype(np.float64)


def seam_check(d):
    """The wrap as the game hears it: the last and first 100 ms levels, and the jump across the seam against the
    file's own sample-to-sample jumps."""
    m = d.mean(axis=1)
    k = int(0.1 * SR)
    def r(a):
        return 20 * np.log10(np.sqrt((a ** 2).mean()) + 1e-12)
    jumps = np.abs(np.diff(d, axis=0)).max(axis=1)
    wrap = np.abs(d[0] - d[-1]).max()
    one = int(1.0 * SR)
    secs = [r(m[i:i + one]) for i in range(0, len(m) - one, one)]
    tenths = np.array([r(m[i:i + k]) for i in range(0, len(m) - k, k)])
    steps100 = np.abs(np.diff(tenths))
    seam100 = abs(r(m[:k]) - r(m[-k:]))
    return dict(rms_last_100ms_db=round(r(m[-k:]), 2), rms_first_100ms_db=round(r(m[:k]), 2),
                rms_step_db=round(r(m[:k]) - r(m[-k:]), 2),
                typical_100ms_step_db=round(float(np.median(steps100)), 2),
                rms_step_percentile=round(float((steps100 < seam100).mean() * 100), 1),
                level_step_1s_db=round(r(m[:one]) - r(m[-one:]), 2),
                typical_1s_step_db=round(float(np.median(np.abs(np.diff(secs)))), 2),
                wrap_jump=round(float(wrap), 5), median_jump=round(float(np.median(jumps)), 5),
                p999_jump=round(float(np.percentile(jumps, 99.9)), 5),
                wrap_jump_percentile=round(float((jumps < wrap).mean() * 100), 1))


def source(fid):
    m = SOURCES["recordings"][fid]
    return dict(freesound_id=int(fid), recordist=m["recordist"], title=m["title"], url=m["url"],
                licence=SOURCES["licence"]["name"], licence_url=SOURCES["licence"]["url"])


def main(out):
    cache.world()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"sample_rate": SR, "codec": "Ogg Opus",
                "levels": {"beds_lufs": BED_LUFS, "one_shots_peak_dbfs": ONE_SHOT_PEAK, "max_lufs": MAX_LUFS,
                           "note": "beds are levelled to one loudness; one-shots to one peak, lowered where that would "
                                   "be louder than the beds (every step in a sprite keeps the same peak); book-shut is "
                                   "book-open at 0.8 gain. The game sets each layer's level. A loop's length is exact: loop it over its whole buffer "
                                   "(samples / sample_rate)."},
                "files": {}}
    jobs = [(b["name"], b["id"], 64, (lambda b=b: make_bed(b)), None) for b in BEDS]
    jobs += [(s["name"], s["id"], 48, (lambda s=s: make_steps(s)), None) for s in STEPS]
    jobs += [(n, fid, 48, fn, why) for n, fid, fn, why in ONE_SHOTS]
    for name, fid, kbps, fn, why in jobs:
        y, info = fn()
        if why:
            info["why"] = why
        path = encode(out, name, y, kbps)
        d = decode(path)
        entry = dict(file=path.name, source=source(fid), **info)
        entry["span"] = dict(start=info["span"][0], end=info["span"][1])
        entry.update(duration_s=round(len(d) / SR, 5), samples=int(len(d)), channels=int(d.shape[1]),
                     bitrate_kbps=kbps, bytes=path.stat().st_size,
                     loudness_lufs=None if lufs(d) is None else round(float(lufs(d)), 1), peak_dbfs=round(float(peak_db(d)), 2))
        assert len(d) == len(y), f"{name}: decoded {len(d)} samples, wrote {len(y)}"
        assert entry["peak_dbfs"] < -1.0, f"{name}: peak {entry['peak_dbfs']} dBFS"
        if info["loop"]:
            entry["seam"] = seam_check(d)
        manifest["files"][path.stem] = entry
        print(f"{path.name:20s} {entry['duration_s']:7.2f}s {entry['channels']}ch {entry['loudness_lufs'] or float('nan'):6.1f} LUFS "
              f"peak {entry['peak_dbfs']:6.2f} {entry['bytes'] / 1024:6.0f} KB"
              + (f"  seam {entry['seam']}" if info["loop"] else ""), flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    write_credits(out, manifest)


def write_credits(out, manifest):
    uses = {}
    for name, e in manifest["files"].items():
        uses.setdefault(e["source"]["freesound_id"], (e["source"], []))[1].append(e["file"])
    lines = ["# World sound credits", "",
             "Every world sound is a field or foley recording from [Freesound](https://freesound.org), released under "
             "[Creative Commons 0 (CC0 1.0)](https://creativecommons.org/publicdomain/zero/1.0/): free for any use, "
             "with no attribution required. They are the recordings Gaia's announcement film used, cut into seamless "
             "loops (a 2 s equal-power crossfade at each seam) and single sounds, high-passed against rumble, and "
             "encoded as Ogg Opus by [`tools/sound/world.py`](../../../../tools/sound/world.py) (`pnpm sound world`). "
             "`manifest.json` gives each file's source, the span of it that was cut, and its loudness.", "",
             "| Recording | Recordist | Source | Licence | Files |", "| --- | --- | --- | --- | --- |"]
    for fid, (s, files) in uses.items():
        lines.append(f"| {s['title']} | {s['recordist']} | {s['url']} | CC0 1.0 | {', '.join(f'`{f}`' for f in files)} |")
    (out / "CREDITS.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
