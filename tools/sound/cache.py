"""What the sound files are made from and too big to commit, fetched once into a cache outside the repository.

Every download is checked against the sha256 in sources.json, so a rebuild starts from the same bytes or stops. The
cache is GAIA_SOUND_CACHE, or ~/.cache/gaia-sound:

  recordings/fs<id>.ogg    the Freesound recordings the world sounds are cut from
  celesta/fs<id>.ogg       the Freesound celesta notes
  vcsl/<path>              the VCSL harp and glockenspiel samples
  VSCO-2-CE-1.1.0/         Versilian Studios' orchestra (3 GB); the music's own patches are written beside its own
  patches/                 the harp, glockenspiel and celesta patches, and the celesta's notes as WAV
  sfizz-1.2.3/bin/         sfizz_render, built from source

A folder already on the machine can stand in for one of these through a symbolic link: it is checked like a download.
"""
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
SOURCES = json.loads((HERE / "sources.json").read_text())
CACHE = Path(os.environ.get("GAIA_SOUND_CACHE") or Path.home() / ".cache" / "gaia-sound").expanduser()
RECORDINGS = CACHE / "recordings"
CELESTA = CACHE / "celesta"
VCSL = CACHE / "vcsl"
VSCO = CACHE / SOURCES["vsco"]["folder"]
PATCHES = CACHE / "patches"
SFIZZ_DIR = CACHE / f"sfizz-{SOURCES['sfizz']['version']}"
SFIZZ = SFIZZ_DIR / "bin" / "sfizz_render"


def require(*programs):
    missing = [p for p in programs if shutil.which(p) is None]
    if missing:
        raise SystemExit(f"the sound tools need {', '.join(missing)} on PATH (tools/sound/README.md)")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(url, dest, digest=None):
    """dest from url, unless it is already there with the right digest."""
    if dest.exists() and (digest is None or sha256(dest) == digest):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    print(f"fetching {url}", flush=True)
    subprocess.run(["curl", "-fL", "--retry", "3", "--silent", "--show-error", "-o", str(part), url], check=True)
    if digest is not None and sha256(part) != digest:
        part.unlink()
        raise SystemExit(f"{url}: its sha256 is not the one in sources.json; the source has changed")
    part.replace(dest)
    return dest


def freesound(group, folder):
    for fid, s in SOURCES[group].items():
        fetch(s["preview"], folder / f"fs{fid}.ogg", s["sha256"])


def vcsl():
    v = SOURCES["vcsl"]
    base = v["repository"].replace("github.com", "raw.githubusercontent.com") + "/" + v["commit"] + "/"
    for rel, digest in v["files"].items():
        fetch(base + quote(rel), VCSL / rel, digest)


def vsco():
    v = SOURCES["vsco"]
    if all((VSCO / p).exists() and sha256(VSCO / p) == d for p, d in v["patches"].items()):
        return
    archive = fetch(v["archive"], CACHE / f"{v['folder']}.zip")
    print(f"unpacking {archive.name}", flush=True)
    with zipfile.ZipFile(archive) as z:
        z.extractall(CACHE)
    archive.unlink()
    wrong = [p for p, d in v["patches"].items() if sha256(VSCO / p) != d]
    if wrong:
        raise SystemExit(f"VSCO 2 CE: these patches are not the ones in sources.json: {wrong}")


def sfizz():
    """sfizz_render, built from the release's source with the system's compiler, two jobs at a time."""
    if SFIZZ.exists():
        return
    require("cmake", "ninja", "c++")
    s = SOURCES["sfizz"]
    archive = fetch(s["archive"], CACHE / f"sfizz-{s['version']}.tar.gz", s["sha256"])
    build = CACHE / "sfizz-build"
    shutil.rmtree(build, ignore_errors=True)
    with tarfile.open(archive) as t:
        t.extractall(build, filter="data")
    src = build / f"sfizz-{s['version']}"
    print("building sfizz_render (a few minutes)", flush=True)
    subprocess.run(["nice", "-n", "10", "cmake", "-S", str(src), "-B", str(build / "out"), "-G", "Ninja",
                    "-DCMAKE_BUILD_TYPE=Release", "-DSFIZZ_SHARED=OFF", "-DSFIZZ_JACK=OFF", "-DSFIZZ_RENDER=ON",
                    "-DSFIZZ_GIT_SUBMODULE_CHECK=OFF"], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["nice", "-n", "10", "cmake", "--build", str(build / "out"), "--target", "sfizz_render", "-j", "2"],
                   check=True, stdout=subprocess.DEVNULL)
    SFIZZ.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(build / "out" / "library" / "bin" / "sfizz_render", SFIZZ)
    shutil.rmtree(build)
    archive.unlink()


def world():
    """Everything the world sounds need."""
    require("curl", "ffmpeg", "ffprobe")
    freesound("recordings", RECORDINGS)


def music():
    """Everything the music needs, before its patches are written."""
    require("curl", "ffmpeg")
    freesound("celesta", CELESTA)
    vcsl()
    vsco()
    sfizz()
