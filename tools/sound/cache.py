"""What the sound files are made from and too big to commit, fetched once into a cache outside the repository.

Every download is checked against the sha256 in sources.json, so a rebuild starts from the same bytes or stops. The
cache is GAIA_SOUND_CACHE, or ~/.cache/gaia-sound:

  recordings/fs<id>.ogg    the Freesound recordings the world sounds are cut from
  celesta/fs<id>.ogg       the Freesound celesta notes
  vcsl/<path>              the VCSL harp and glockenspiel samples
  VSCO-2-CE-1.1.0/         Versilian Studios' orchestra (3 GB), with the music's own patches written beside its own
  patches/                 the harp, glockenspiel and celesta patches, and the celesta's notes as WAV
  sfizz-1.2.3/bin/         sfizz_render, built from source

A symbolic link can point one of these at a folder already on the machine, and it is checked like a download.
This module also provides `run_command` to invoke external CLI tools (curl, cmake, ffmpeg, ffprobe, sfizz_render)
via resolved executable paths.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import zipfile
from collections.abc import Sequence
from pathlib import Path
from typing import IO, Literal, TypedDict
from urllib.parse import quote


class _LicenceInfo(TypedDict):
    name: str
    url: str


class _FreesoundRecording(TypedDict):
    preview: str
    sha256: str
    recordist: str
    title: str
    url: str


class _VcslSource(TypedDict):
    repository: str
    commit: str
    files: dict[str, str]


class _VscoSource(TypedDict):
    folder: str
    archive: str
    patches: dict[str, str]


class _SfizzSource(TypedDict):
    version: str
    archive: str
    sha256: str


class _SourcesManifest(TypedDict):
    licence: _LicenceInfo
    recordings: dict[str, _FreesoundRecording]
    celesta: dict[str, _FreesoundRecording]
    vcsl: _VcslSource
    vsco: _VscoSource
    sfizz: _SfizzSource


HERE = Path(__file__).resolve().parent
SOURCES: _SourcesManifest = json.loads((HERE / "sources.json").read_text())
CACHE = Path(os.environ.get("GAIA_SOUND_CACHE") or Path.home() / ".cache" / "gaia-sound").expanduser()
RECORDINGS = CACHE / "recordings"
CELESTA = CACHE / "celesta"
VCSL = CACHE / "vcsl"
VSCO = CACHE / SOURCES["vsco"]["folder"]
PATCHES = CACHE / "patches"
SFIZZ_DIR = CACHE / f"sfizz-{SOURCES['sfizz']['version']}"
SFIZZ = SFIZZ_DIR / "bin" / "sfizz_render"


def _resolve_executable(program: str | Path) -> str:
    if isinstance(program, Path):
        return str(program)
    resolved = shutil.which(program)
    if resolved is None:
        sys.exit(f"the sound tools need {program} on PATH (tools/sound/README.md)")
    return resolved


def run_command(
    program: str | Path,
    args: Sequence[str],
    *,
    nice: bool = False,
    check: bool = True,
    capture_output: bool = False,
    stdin_bytes: bytes | None = None,
    stdout: int | IO[str] | None = None,
    stderr: int | None = None,
) -> subprocess.CompletedProcess[bytes]:
    cmd = [_resolve_executable(program), *args]
    if nice:
        cmd = [_resolve_executable("nice"), "-n", "10", *cmd]
    return subprocess.run(  # noqa: S603 -- executes resolved local build/media binary with fixed argv
        cmd,
        check=check,
        capture_output=capture_output,
        input=stdin_bytes,
        stdout=stdout,
        stderr=stderr,
    )


def require(*programs: str) -> None:
    missing = [p for p in programs if shutil.which(p) is None]
    if missing:
        sys.exit(f"the sound tools need {', '.join(missing)} on PATH (tools/sound/README.md)")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(url: str, dest: Path, *, digest: str | None = None) -> Path:
    if dest.exists() and (digest is None or sha256(dest) == digest):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    print(f"fetching {url}", flush=True)
    run_command("curl", ["-fL", "--retry", "3", "--silent", "--show-error", "-o", str(part), url])
    if digest is not None and sha256(part) != digest:
        part.unlink()
        sys.exit(f"{url}: its sha256 is not the one in sources.json; the source has changed")
    part.replace(dest)
    return dest


def freesound(group: Literal["recordings", "celesta"], folder: Path) -> None:
    for fid, s in SOURCES[group].items():
        fetch(s["preview"], folder / f"fs{fid}.ogg", digest=s["sha256"])


def vcsl() -> None:
    v = SOURCES["vcsl"]
    base = v["repository"].replace("github.com", "raw.githubusercontent.com") + "/" + v["commit"] + "/"
    for rel, digest in v["files"].items():
        fetch(base + quote(rel), VCSL / rel, digest=digest)


def _extract_zip_safely(archive: Path, dest: Path) -> None:
    dest_root = dest.resolve()
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            target = (dest_root / info.filename).resolve()
            if not target.is_relative_to(dest_root):
                sys.exit(f"{archive.name}: unsafe archive entry {info.filename!r}")
            z.extract(info, dest_root)


def vsco() -> None:
    v = SOURCES["vsco"]
    if all((VSCO / p).exists() and sha256(VSCO / p) == d for p, d in v["patches"].items()):
        return
    archive = fetch(v["archive"], CACHE / f"{v['folder']}.zip")
    print(f"unpacking {archive.name}", flush=True)
    _extract_zip_safely(archive, CACHE)
    archive.unlink()
    wrong = [p for p, d in v["patches"].items() if sha256(VSCO / p) != d]
    if wrong:
        sys.exit(f"VSCO 2 CE: these patches are not the ones in sources.json: {wrong}")


def sfizz() -> None:
    if SFIZZ.exists():
        return
    require("cmake", "ninja", "c++")
    s = SOURCES["sfizz"]
    archive = fetch(s["archive"], CACHE / f"sfizz-{s['version']}.tar.gz", digest=s["sha256"])
    build = CACHE / "sfizz-build"
    shutil.rmtree(build, ignore_errors=True)
    with tarfile.open(archive) as t:
        t.extractall(build, filter="data")
    src = build / f"sfizz-{s['version']}"
    print("building sfizz_render (a few minutes)", flush=True)
    run_command(
        "cmake",
        [
            "-S",
            str(src),
            "-B",
            str(build / "out"),
            "-G",
            "Ninja",
            "-DCMAKE_BUILD_TYPE=Release",
            "-DSFIZZ_SHARED=OFF",
            "-DSFIZZ_JACK=OFF",
            "-DSFIZZ_RENDER=ON",
            "-DSFIZZ_GIT_SUBMODULE_CHECK=OFF",
        ],
        nice=True,
        stdout=subprocess.DEVNULL,
    )
    run_command(
        "cmake",
        ["--build", str(build / "out"), "--target", "sfizz_render", "-j", "2"],
        nice=True,
        stdout=subprocess.DEVNULL,
    )
    SFIZZ.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(build / "out" / "library" / "bin" / "sfizz_render", SFIZZ)
    shutil.rmtree(build)
    archive.unlink()


def world() -> None:
    require("curl", "ffmpeg", "ffprobe")
    freesound("recordings", RECORDINGS)


def music() -> None:
    require("curl", "ffmpeg")
    freesound("celesta", CELESTA)
    vcsl()
    vsco()
    sfizz()
