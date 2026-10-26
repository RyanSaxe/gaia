"""Fetch what the sound files are made from, then rebuild them: the world's sounds and the music.

Usage: build.py [world|music] [--out ASSETS_DIR] [--keep]
  world, music  only that half (default: both)
  --out         where the files go (default: app/renderer/sound/assets; the music goes in its music/ folder)
  --keep        keep the music's MIDI, rendered parts and mixed stems in the cache's work/ folder
"""
import argparse
import shutil
import time
from pathlib import Path

import cache

REPO = Path(__file__).resolve().parents[2]


def music(out, keep):
    from music import compose, encode, mix, patches, render
    cache.music()
    patches.write()
    work = cache.CACHE / "work"
    shutil.rmtree(work, ignore_errors=True)
    try:
        compose.main(work / "midi")
        render.main(work / "midi", work / "parts")
        mix.main(work, work / "stems")
        encode.main(work / "stems", out / "music")
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("half", nargs="?", choices=("world", "music"))
    ap.add_argument("--out", type=Path, default=REPO / "app" / "renderer" / "sound" / "assets")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    out = args.out.resolve()
    start = time.time()
    if args.half in (None, "world"):
        import world
        world.main(out)
    if args.half in (None, "music"):
        music(out, args.keep)
    print(f"done in {time.time() - start:.0f} s: {out}")


if __name__ == "__main__":
    main()
