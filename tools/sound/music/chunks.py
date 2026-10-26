"""The piece's four stems as chunks the game streams: each stem cut into 4-bar chunks, each chunk encoded on its own
as Ogg Opus with a little of the music either side of it, and the chunks of a stem laid end to end in one file.

The game decodes one chunk just before it plays and keeps only the chunk's own frames. The music either side of a
chunk is there for the codec: an Opus stream starts and ends a few milliseconds off the signal it was given, so a
chunk cut without it would click where it meets the next. With it, the frames the game keeps are as close to the
music as a single long encode would make them, and the joins are inaudible.

Usage: python -m music.chunks STEMS_DIR OUT_DIR MANIFEST.json   (from tools/sound)
  STEMS_DIR holds bed.wav, melody.wav, shimmer.wav and minor.wav (48 kHz stereo, one loop each, all one length).
  Writes OUT_DIR/<stem>.ogg (the chunks laid end to end) and adds "chunks" and "chunk" to MANIFEST.json's "piece".
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

STEMS = ["bed", "melody", "shimmer", "minor"]
RATE = 48000
BARS_PER_CHUNK = 4
# The music either side of a chunk that the codec settles on, frames: 0.1 s, five Opus frames.
MARGIN = 4800
BITRATE = "96k"


def encode(x: np.ndarray) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        wav, ogg = Path(tmp) / "c.wav", Path(tmp) / "c.ogg"
        sf.write(wav, x.astype(np.float32), RATE, subtype="FLOAT")
        subprocess.run(["nice", "-n", "10", "ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libopus", "-b:a",
                        BITRATE, "-ar", str(RATE), "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                        str(ogg)], check=True)
        return ogg.read_bytes()


def decode(data: bytes) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-f", "ogg", "-i", "pipe:0", "-f", "f32le", "-ac", "2", "-ar", str(RATE),
                          "pipe:1"], input=data, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2)


def main(stems_dir, out_dir, manifest_path):
    stems_dir, out_dir, manifest_path = Path(stems_dir), Path(out_dir), Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    piece = manifest["piece"]
    chunk = round(RATE * 60 / piece["bpm"] * 4) * BARS_PER_CHUNK
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {}
    for stem in STEMS:
        x, rate = sf.read(stems_dir / f"{stem}.wav", always_2d=True)
        assert rate == RATE, f"{stem} is at {rate} Hz"
        loop = len(x)
        assert loop % chunk == 0, f"{stem}: {loop} frames is not a whole number of {chunk}-frame chunks"
        count = loop // chunk
        # The loop's music either side of each chunk wraps round, since the piece plays round without end.
        wrapped = np.concatenate([x[-MARGIN:], x, x[:MARGIN]])
        files, spans, kept = [], [], []
        at = 0
        for k in range(count):
            data = encode(wrapped[k * chunk: (k + 1) * chunk + 2 * MARGIN])
            decoded = decode(data)
            assert len(decoded) == chunk + 2 * MARGIN, f"{stem} chunk {k} decodes to {len(decoded)} frames"
            kept.append(decoded[MARGIN: MARGIN + chunk])
            spans.append({"at": at, "bytes": len(data)})
            files.append(data)
            at += len(data)
        (out_dir / f"{stem}.ogg").write_bytes(b"".join(files))
        # How close the streamed stem is to the music, and how large the joins are against the stem's own steps.
        streamed = np.concatenate(kept)
        err = streamed - x
        snr = 10 * np.log10((x ** 2).sum() / max((err ** 2).sum(), 1e-20))
        steps = np.abs(np.diff(streamed, axis=0)).max(axis=1)
        joins = [float(np.abs(streamed[k * chunk] - streamed[k * chunk - 1]).max()) for k in range(1, count)]
        joins.append(float(np.abs(streamed[0] - streamed[-1]).max()))
        report[stem] = {"snr_db": round(float(snr), 1), "join_max": round(max(joins), 5),
                        "step_p99": round(float(np.percentile(steps, 99)), 5), "bytes": at}
        piece.setdefault("chunks", {})[stem] = spans
    piece["chunk"] = {"frames": chunk, "margin": MARGIN, "rate": RATE}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:4])
