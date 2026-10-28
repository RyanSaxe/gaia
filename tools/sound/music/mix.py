"""Mix the music: the piece's four looping stems and the seven phrases, as 48 kHz stereo float WAVs.

Each part gets the announcement film's treatment: a fixed fader from its patch's calibration (calibration.json) plus
its seat's level, a high-pass, air, a seat in the stereo field and a send to one convolution reverb, whose impulse is
made here (band-shaped decaying noise with early reflections, from a fixed seed). Every filter and the reverb are
applied in the frequency domain:
- the piece: each part's render is folded onto one loop length (everything after bar 32, every release and the
  harp's ring, is added back onto bar 1, and the pre-roll's lead-ins onto bar 32), so each part is exactly periodic,
  and the filters and reverb act on that periodic signal (circular convolution), which is the steady state of the
  loop playing forever. The last bar's reverb sounds over the first, with no seam.
- the phrases: zero-padded by the reverb's length, so the same code gives an ordinary linear mix with its tail.

Levels: one gain for all four stems brings bed + melody to -21 LUFS, so the stems keep their musical balance. Each
phrase is brought to -21 LUFS. A phrase whose true peak would pass -3.3 dBTP goes through a look-ahead limiter.
There is no bus compression. The dynamics come from the notes' velocities and CC swells.

Usage: mix.py WORK_DIR OUT_DIR   (reads WORK_DIR/midi/<song>/ and WORK_DIR/parts/<song>/; writes OUT_DIR/<stem>.wav,
OUT_DIR/<phrase>.wav and OUT_DIR/mix-report.json)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d

SR = 48000
TARGET = -21.0
CEIL_DBTP = -3.3  # -3 dBFS with room for the Opus encoder's overshoot
CAL = Path(__file__).resolve().parent / "calibration.json"
METER = pyln.Meter(SR)


def calibration(names):
    """Each patch's reference loudness. A patch not yet measured is measured once and kept in calibration.json."""
    cal = json.loads(CAL.read_text())
    missing = [n for n in names if Path(n).name not in cal]
    if missing:
        from .calibrate import loudness
        for n in missing:
            cal[Path(n).name], notes = loudness(n)
            print(f"calibrated {Path(n).name}: {cal[Path(n).name]} LUFS (notes {notes})")
        CAL.write_text(json.dumps(cal, indent=1, sort_keys=True) + "\n")
    return cal


def impulse(rt=(2.6, 2.3, 1.8, 1.1), length=3.2, predelay=0.018, seed=7):
    """Stereo hall-like impulse: four bands decaying at their own rates, plus early reflections."""
    rng = np.random.default_rng(seed)
    n = int(length * SR)
    t = np.arange(n) / SR
    bands = [(None, 300), (300, 2000), (2000, 6000), (6000, None)]
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        for (lo, hi), rt60 in zip(bands, rt):
            if lo is None:
                sos = signal.butter(4, hi, "lowpass", fs=SR, output="sos")
            elif hi is None:
                sos = signal.butter(4, lo, "highpass", fs=SR, output="sos")
            else:
                sos = signal.butter(4, [lo, hi], "bandpass", fs=SR, output="sos")
            env = 10 ** (-3 * t / rt60)  # -60 dB at rt60
            ir[:, ch] += signal.sosfilt(sos, noise) * env
        ir[:, ch] *= np.clip(t / 0.06, 0, 1) ** 1.5  # diffuse tail builds over 60 ms
        for _ in range(14):  # early reflections in the first 90 ms
            k = int(rng.uniform(0.004, 0.09) * SR)
            ir[k, ch] += rng.uniform(0.25, 0.7) * rng.choice([-1, 1])
    pad = int(predelay * SR)
    ir = np.vstack([np.zeros((pad, 2)), ir])
    return ir / np.sqrt((ir ** 2).sum() / 2)


def shelf(f0, gain_db, kind):
    """A high shelf's biquad (b, a)."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / 2 * np.sqrt(2)
    c = np.cos(w0)
    if kind == "high":
        b = [A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * alpha), -2 * A * ((A - 1) + (A + 1) * c),
             A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * alpha)]
        a = [(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * alpha, 2 * ((A - 1) - (A + 1) * c),
             (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * alpha]
    return np.array(b) / a[0], np.array(a) / a[0]


def limit(x, sr, ceiling, look=0.005, release=0.08):
    """A look-ahead peak limiter that watches a 4x oversampled copy, so inter-sample peaks count."""
    up = signal.resample_poly(x, 4, 1, axis=0)
    pk = np.abs(up).max(axis=1).reshape(-1, 4).max(axis=1)[: len(x)]
    pk = np.pad(pk, (0, len(x) - len(pk)))
    need = np.minimum(1.0, ceiling / np.maximum(pk, 1e-9))
    la = int(look * sr)
    # look ahead: each sample takes the smallest gain needed within the next `la` samples
    centred = minimum_filter1d(need, size=2 * (la // 2) + 1, mode="nearest")
    need = np.concatenate([centred[la // 2:], np.full(la // 2, centred[-1])])
    g = np.empty_like(need)
    rel = np.exp(-1 / (release * sr))
    att = np.exp(-1 / (look * sr / 2))
    cur = 1.0
    for i, v in enumerate(need):
        cur = att * cur + (1 - att) * v if v < cur else rel * cur + (1 - rel) * v
        g[i] = min(cur, v)
    return x * g[:, None], 20 * np.log10(g.min())


def true_peak(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max())


def seat(x, pan, width):
    mid, side = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2 * width
    l, r = mid + side, mid - side
    a = (pan + 1) * np.pi / 4
    return np.stack([l * np.cos(a) * np.sqrt(2), r * np.sin(a) * np.sqrt(2)], axis=1)


def fold(x, start, n):
    """Everything the render holds, laid onto one period of n samples beginning at sample `start`."""
    y = np.zeros((n, 2))
    pre = x[:start]
    y[n - len(pre):] += pre
    rest = x[start:]
    for k in range(0, len(rest), n):
        seg = rest[k:k + n]
        y[:len(seg)] += seg
    return y


def response(freqs, sos=None, ba=None):
    if sos is not None:
        return signal.sosfreqz(sos, worN=freqs, fs=SR)[1]
    return signal.freqz(ba[0], ba[1], worN=freqs, fs=SR)[1]


def mix(song_dir, parts_dir, periodic):
    meta = json.load(open(song_dir / "timing.json"))
    parts = json.load(open(song_dir / "parts.json"))
    cal = calibration(sorted({v["sfz"] for v in parts.values()}))
    rv = meta["reverb"]
    ir = impulse(rt=tuple(rv["rt"]), length=rv["length"])
    if periodic:
        n = int(round(meta["loop_seconds"] * SR))
        start = int(round(meta["loop_start"] * SR))
    else:
        longest = max(sf.info(str(parts_dir / f"{p}.wav")).frames for p in parts)
        n = longest + len(ir) + SR
        start = 0
    freqs = np.fft.rfftfreq(n, 1 / SR)
    groups = meta["stems"]
    owner = {p: g for g, names in groups.items() for p in names}
    dry = {g: np.zeros((len(freqs), 2), complex) for g in groups}
    send = {g: np.zeros((len(freqs), 2), complex) for g in groups}
    for pname, (lvl, pan, width, hp, rev, air) in meta["seats"].items():
        f = parts_dir / f"{pname}.wav"
        if pname not in parts or not f.exists():
            continue
        x, sr = sf.read(f, always_2d=True)
        assert sr == SR, (f, sr)
        x = fold(x, start, n) if periodic else np.vstack([x, np.zeros((n - len(x), 2))])
        ref = cal[Path(parts[pname]["sfz"]).name]
        x = seat(x * 10 ** ((-20 - ref + lvl) / 20), pan, width)
        h = response(freqs, sos=signal.butter(2, hp, "highpass", fs=SR, output="sos"))
        if air:
            h = h * response(freqs, ba=shelf(6000, air, "high"))
        X = np.fft.rfft(x, axis=0) * h[:, None]
        dry[owner[pname]] += X
        send[owner[pname]] += X * 10 ** (rev / 20)
    irp = np.zeros((n, 2))
    irp[:len(ir)] = ir
    IR = np.fft.rfft(irp, axis=0)
    wet_h = (response(freqs, sos=signal.butter(2, 200, "highpass", fs=SR, output="sos"))
             * response(freqs, sos=signal.butter(2, 9500, "lowpass", fs=SR, output="sos")))
    stems = {}
    for g in groups:
        Y = dry[g] + send[g] * IR * wet_h[:, None] * 10 ** (rv.get("wet_db", 0) / 20)
        stems[g] = np.fft.irfft(Y, n=n, axis=0)
    return meta, stems


def lufs(x):
    return float(METER.integrated_loudness(x))


def wrap_check(x):
    """Level either side of the wrap, and the step across it against the largest steps anywhere else."""
    k = int(0.1 * SR)
    before = 20 * np.log10(np.sqrt((x[-k:] ** 2).mean()) + 1e-12)
    after = 20 * np.log10(np.sqrt((x[:k] ** 2).mean()) + 1e-12)
    d = np.abs(np.diff(x, axis=0)).max(axis=1)
    jump = np.abs(x[0] - x[-1]).max()
    pct = (d < jump).mean() * 100
    return {"rms_before_db": round(before, 2), "rms_after_db": round(after, 2), "step": float(jump),
            "step_percentile": round(pct, 2), "largest_step": float(d.max())}


def trim(x):
    """From the first sound to where the decay falls below -66 dBFS (50 ms RMS), with a 0.4 s fade to silence."""
    a = np.abs(x).max(axis=1)
    first = int(np.argmax(a > 10 ** (-70 / 20)))
    w = int(0.05 * SR)
    rms = np.sqrt(np.convolve((x ** 2).mean(axis=1), np.ones(w) / w, mode="same"))
    loud = np.where(rms > 10 ** (-66 / 20))[0]
    last = min(len(x), int(loud[-1]) + w)
    y = x[max(0, first - int(0.005 * SR)):last].copy()
    f = int(0.4 * SR)
    y[-f:] *= (np.cos(np.linspace(0, np.pi, f)) * 0.5 + 0.5)[:, None]
    return y


def master_phrase(x):
    gain = TARGET - lufs(x)
    ceiling = 10 ** (CEIL_DBTP / 20)
    lim = 0.0
    y = x * 10 ** (gain / 20)
    for _ in range(8):
        y = x * 10 ** (gain / 20)
        if true_peak(y) > CEIL_DBTP:
            y, lim = limit(y, SR, ceiling)
        v = lufs(y)
        if abs(v - TARGET) < 0.05:
            break
        gain += TARGET - v
    return y, gain, lim


def main(work, out):
    work, out = Path(work), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    report = {}
    # ---- the piece
    meta, st = mix(work / "midi" / "piece", work / "parts" / "piece", periodic=True)
    g = TARGET - lufs(st["bed"] + st["melody"])
    for k in st:
        st[k] = st[k] * 10 ** (g / 20)
    mixes = {"piece-day": st["bed"] + st["melody"], "piece-night": st["bed"] + 0.6 * st["melody"] + st["shimmer"],
             "piece-ruin": st["minor"], "all-major-stems": st["bed"] + st["melody"] + st["shimmer"]}
    worst = max(true_peak(x) for x in list(st.values()) + list(mixes.values()))
    if worst > CEIL_DBTP:
        raise SystemExit(f"the piece peaks at {worst:.2f} dBTP: soften the loudest notes rather than limit a loop")
    for k, x in st.items():
        sf.write(out / f"{k}.wav", x.astype(np.float32), SR, subtype="FLOAT")
        report[k] = {"lufs": round(lufs(x), 2), "true_peak_dbtp": round(true_peak(x), 2), "samples": len(x),
                     "wrap": wrap_check(x)}
    for k, x in mixes.items():
        report[k] = {"lufs": round(lufs(x), 2), "true_peak_dbtp": round(true_peak(x), 2), "wrap": wrap_check(x)}
    report["_piece"] = {"gain_db": round(g, 2), "bars": meta["bars"], "bpm": meta["bpm"], "seconds": meta["loop_seconds"],
                        "samples": len(st["bed"])}
    # ---- the phrases
    for d in sorted((work / "midi").iterdir()):
        if not d.name.startswith("phrase-"):
            continue
        _, ps = mix(d, work / "parts" / d.name, periodic=False)
        x = trim(sum(ps.values()))
        y, gain, lim = master_phrase(x)
        sf.write(out / f"{d.name}.wav", y.astype(np.float32), SR, subtype="FLOAT")
        report[d.name] = {"lufs": round(lufs(y), 2), "true_peak_dbtp": round(true_peak(y), 2),
                          "seconds": round(len(y) / SR, 2), "limiter_db": round(lim, 2)}
    (out / "mix-report.json").write_text(json.dumps(report, indent=1))
    for k, v in report.items():
        print(f"{k:16s} {json.dumps(v)}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
