# Sound tools

These scripts make every file in [`app/renderer/sound/assets/`](../../app/renderer/sound/assets/).

```sh
pnpm sound          # set up, then rebuild the world's sounds and the music
pnpm sound world    # only the world's sounds
pnpm sound music    # only the music
```

`--out DIR` writes somewhere else, for comparing a rebuild with the committed files; `--keep` keeps the music's
MIDI, rendered parts and mixed stems in the cache's `work/` folder. The same sources, tools and code give the same
files, byte for byte.

## What it needs

[uv](https://docs.astral.sh/uv/), which installs Python 3.12 and the pinned packages in `uv.lock`; `curl`; and
`ffmpeg` and `ffprobe` built with libopus. The first music build also compiles sfizz, which needs CMake, Ninja and a
C++ compiler.

## The cache

What is too big to commit is fetched once into `~/.cache/gaia-sound/`, or `GAIA_SOUND_CACHE`, and checked against
the sha256 sums in [`sources.json`](sources.json): the Freesound recordings and celesta notes (CC0), the VCSL harp
and glockenspiel samples at a pinned commit (CC0), VSCO 2 Community Edition 1.1.0 (CC0, a 2.2 GB download that
unpacks to 3 GB), and sfizz 1.2.3's source (BSD 2-Clause), built into `sfizz-1.2.3/bin/sfizz_render`.
[`cache.py`](cache.py) lists the folders. A copy you already have can stand in for a download through a symbolic
link, such as `VSCO-2-CE-1.1.0` to an unpacked VSCO 2 CE; it is checked the same way.

## The world's sounds

[`world.py`](world.py) cuts each bed from the steadiest stretch of its recording, closes it into a seamless loop,
cuts the footsteps and the journal's paper into single sounds, and levels and encodes them. Each file's reasons are
beside its entry, and the manifest records them.

## The music

[`music/`](music/) runs in stages, each reading only what the one before wrote:

| Stage | Reads | Writes |
| --- | --- | --- |
| [`compose.py`](music/compose.py) | the score, in code | MIDI, `parts.json` and `timing.json` for the piece and each phrase |
| [`render.py`](music/render.py) | the MIDI and the patches | one WAV per part, through `sfizz_render` |
| [`mix.py`](music/mix.py) | the parts | the four stems and seven phrases as WAVs, and `mix-report.json` |
| [`encode.py`](music/encode.py) | the WAVs and the report | the Ogg files and `manifest.json` |

[`patches.py`](music/patches.py) writes the SFZ patches the libraries don't ship, and
[`chunks.py`](music/chunks.py) is the encode's last step: the four stems as 4-bar chunks the game streams.
[`calibration.json`](music/calibration.json) holds each patch's reference loudness for the mix, measured once by
[`calibrate.py`](music/calibrate.py), and [`pitchcal.json`](music/pitchcal.json) how much the lead patches' registers
are evened out; `uv run python -m music.calibrate pitches`, in this folder, measures it again.
