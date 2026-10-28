# Sound tools

These scripts make every file in [`app/renderer/sound/assets/`](../../app/renderer/sound/assets/).

```sh
pnpm sound          # set up, then rebuild the world's sounds and the music
pnpm sound world    # only the world's sounds
pnpm sound music    # only the music
```

`--out DIR` writes the files to `DIR`, for comparing a rebuild with the committed files. `--keep` keeps the music's
MIDI, rendered parts and mixed stems in the cache's `work/` folder. The same sources, tools and code produce the same
files, byte for byte.

## What it needs

The scripts need [uv](https://docs.astral.sh/uv/), which installs Python 3.12 and the packages pinned in `uv.lock`.
They also need `curl`, and `ffmpeg` and `ffprobe` built with libopus. The first music build also compiles sfizz, which
needs CMake, Ninja and a C++ compiler.

## The cache

Files too large to commit are downloaded once into `~/.cache/gaia-sound/`, or into `GAIA_SOUND_CACHE` if it is set,
and checked against the sha256 sums in [`sources.json`](sources.json). They are:

- the Freesound recordings and celesta notes (CC0)
- the VCSL harp and glockenspiel samples at a pinned commit (CC0)
- VSCO 2 Community Edition 1.1.0 (CC0), a 2.2 GB download that unpacks to 3 GB
- sfizz 1.2.3's source (BSD 2-Clause), built into `sfizz-1.2.3/bin/sfizz_render`

[`cache.py`](cache.py) lists the folders. To reuse a copy you already have, put a symbolic link to it in the cache,
such as `VSCO-2-CE-1.1.0` pointing to an unpacked VSCO 2 CE. The scripts check a linked copy the same way as a
download.

## The world's sounds

[`world.py`](world.py) cuts each bed, a looping background sound, from the steadiest stretch of its recording and
crossfades it into a seamless loop. It cuts the footsteps and the journal's paper into single sounds, then levels and
encodes every file. The reason for each cut is beside its entry in `world.py`, and the manifest records it.

## The music

[`music/`](music/) runs in stages. Each stage reads only what the stage before it wrote:

| Stage | Reads | Writes |
| --- | --- | --- |
| [`compose.py`](music/compose.py) | the score in [`score.py`](music/score.py) | MIDI, `parts.json` and `timing.json` for the piece and each phrase |
| [`render.py`](music/render.py) | the MIDI and the patches | one WAV per part, through `sfizz_render` |
| [`mix.py`](music/mix.py) | the parts | the four stems and seven phrases as WAVs, and `mix-report.json` |
| [`encode.py`](music/encode.py) | the WAVs and the report | the Ogg files and `manifest.json` |

[`patches.py`](music/patches.py) writes the SFZ patches the libraries don't ship. [`chunks.py`](music/chunks.py) is
the last step of encoding. It cuts the four stems into the 4-bar chunks the game streams.
[`calibration.json`](music/calibration.json) holds each patch's reference loudness for the mix, measured once by
[`calibrate.py`](music/calibrate.py). [`pitchcal.json`](music/pitchcal.json) holds the corrections that even out the
loudness of the lead patches' registers. To measure them again, run `uv run python -m music.calibrate pitches` in this
folder.
