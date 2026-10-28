# Development

Start with the [README](../README.md) and [Jev setup](connect-jev.md).
The project uses Node 26, pnpm 10, Git and stable Rust from rustup. Install
`curl` as well. The engine uses it for OpenRouter requests and grammar
downloads. `pnpm engine` selects rustup's cargo through `tools/cargo-env.ts`.

## Run the app

`pnpm dev` builds the engine and starts Electron. Set `GAIA_JEV=live` and
`OPENROUTER_API_KEY` in your environment to judge a new codebase. Without live
access, Gaia can open bundled worlds or reuse a complete set of saved answers.

Set `GAIA_PROJECT` to a local project path to skip the start page, or to
`proving`, `showcase` or `showcase-fixed` for a bundled test world. Set
`GAIA_ENGINE` to use an engine binary at a different path.

To test requests without spending money or sending code to OpenRouter, use
the local stand-in described in [Jev setup](connect-jev.md#local-development).

## The standalone lab

```sh
pnpm lab:html
```

Open `dist/lab.html` in a browser. It bundles the renderer, fonts and world
fixtures into one offline page. It has no engine connection and opens the
[showcase](showcase.md) unless a query names another world. The showcase opens
from its saved Jev answers. If an answer is missing, the page fails and names
the request.

| Query | Use |
| --- | --- |
| `?world=proving` | Every supported visual feature, including ruin |
| `?world=showcase` | A small codebase with healthy and poor code, and the page's world when no query names one |
| `?world=showcase-fixed` | The same showcase with its broken module repaired |
| `?hour=22` | Pin the lighting to an hour |
| `?start` | Show the start page |
| `?sound=record` | Play nothing aloud, and keep what the person hears for `__lab.sound.render()` |

Queries can be combined, for example `?world=proving&hour=22`.

`pnpm lab:serve` rebuilds and serves the page on the machine's Tailscale IPv4
address. It listens on port 5180 by default. Set `LAB_PORT` to choose another
free port. Check for an existing server before starting one.

For scripted inspection, the page exposes `window.__lab`:

```js
__lab.hour(22)
__lab.terrain.tour()
__lab.terrain.tour("ruined bridge")
__lab.terrain.walk(0, 0, 90, 0)
__lab.terrain.calls()
__lab.sound.level()       // dBFS leaving the page, also in a muted window
__lab.sound.decoded()     // MB of decoded sound the page holds now
__lab.sound.record(true)  // with ?sound=record: keep a walk, then
__lab.sound.render({ music: "layers" })  // its sound as base64 WAV
```

[main.ts](../app/renderer/main.ts) defines `window.__lab` and its top-level
hooks, such as `hour`. The `terrain`, `immersive` and `sound` hooks are defined
in [terrain/hooks.ts](../app/renderer/terrain/hooks.ts),
[immersive/view.ts](../app/renderer/immersive/view.ts) and
[sound/index.ts](../app/renderer/sound/index.ts). Scripted Electron windows
call `webContents.setAudioMuted(true)`, so a run never plays through the
machine's speakers.
[shots.ts](../tools/shots.ts) is an example of driving the page.

## Visual verification

Use the [proving ground](proving-ground.md) to inspect every affected form at
vitality 1, 0.65 and 0.3, by day and at night. Also open Gaia's own checkout in
the app to catch changes that only appear in a large composition. After the
first live open, the app keeps Jev's answers for it in its own store.

| Command | Result |
| --- | --- |
| `pnpm shots` | Captures all proving-ground stops into `shots/` |
| `pnpm shots willow` | Captures stops matching the supplied word |
| `pnpm shots sky` | Captures the first stop under each of the sweep's skies |
| `pnpm brand` | Regenerates the app's brand images and macOS icon |

For changes to frame cost or walking detail, compare before and after on a
quiet machine with `pnpm probe`. Its Electron window stays hidden except
during the hitch walk. Leave the window uncovered while it shows.

| Probe | Measures |
| --- | --- |
| `pnpm probe drawn` | Frame time, draw calls and triangles by kind and pass |
| `pnpm probe steps` | Changes during walking with the wind frozen |
| `pnpm probe hitch` | Frame times and stutters during a walk |
| `pnpm probe swap` | Transitions between full geometry and baked far forms |
| `pnpm probe likeness` | Baked far forms beside their full forms at and past the swap |
| `pnpm probe stress` | The proving ground with five times as many code trees |
| `pnpm probe paint` | Journal painting capture and rendering |

`--world showcase` or `--world proving` selects a world. Unless one is named,
the swap test runs in the showcase and the likeness test in the proving
ground. `--spot` limits the stops, and `--dpr` sets the pixel ratio. A probe
fails on any WebGL error. A timing from a busy machine is not a reliable
baseline.

The likeness test places one copy of every build that has a far form, at
vitality 1, 0.65 and 0.3. It draws each copy as its far form and as its full
form, at its swap size and at a half, a quarter and an eighth of it. Haze is
off while it draws, because haze would fade both forms alike. At each size it
compares how much of the crown's part of the screen each form covers. Below
the swap size, a far form's coverage may stray no farther from its full form's
than it does at the swap size, within the margins in `LIKENESS_BAR`
([`probe.ts`](../tools/probe.ts)). The test fails otherwise. It also reports
each form's ink, which is the form's mean change from the empty view, and how
much the two forms differ cell by cell.
`__lab.terrain.likeness(name, vitality, sizes, true)` also returns the empty
view, the far form and the full form as pictures.

## Components and fixtures

To add a primitive:

1. Declare it in `packages/primitives/src/` with pure geometry in `geometry/`.
   Fill every vitality channel and describe its closed parameters for Jev.
2. Add it to its family's list, such as `FLORA_PRIMITIVES` in `flora.ts`,
   which `library.ts` collects into `PRIMITIVES`. Shared contract tests cover
   determinism, parameter ranges, channel ranges, triangle budgets and
   vitality response.
3. The [proving ground](proving-ground.md) picks it up without extra work. The
   lab, the app and the tests build the proving ground from the plan in
   `tools/proving.ts`. Its sky, lands, buildings, landmarks, trails, trees,
   bushes, stones and flowers are sweeps of the parts Jev composes them from
   (`sweep` in [`@gaia/world`](../packages/world/src/sweep.ts)). A new part
   therefore appears there with each of its options, at high, middle and low
   vitality. If the plan has no place the part needs, such as an area with
   running water, the build fails and names what is missing. Add a directory
   to the plan for it. A new part for trees, bushes, stones or flower drifts
   also needs words that give every option a feel, which `looks.test.ts`
   checks. Inspect the result in the app and in screenshots.
4. Add how the map draws the primitive, in `app/renderer/immersive/marks.ts`
   for a part of a building or landmark, or in
   `app/renderer/immersive/plant-marks.ts` for a part of a tree, bush, stone or
   flower drift. Their contract tests check every primitive in those roles.

The lab's fixture bundles live in `app/renderer/terrain/fixtures/`:

| Bundle | Source and regeneration |
| --- | --- |
| `proving*` | The made-up codebase planned in `tools/proving.ts`, with its sweeps. These files are not committed. The lab, the app and the tests generate its facts and judgments when they build ([`proving-ground.ts`](../tools/proving-ground.ts)), and `pnpm proving` writes the same files. |
| `showcase*` | Source bundles, judged graphs and saved Jev answers for the [showcase](showcase.md). |

The repository keeps Jev's answers for the showcase only. To count the
requests and cost of composing another project's world, such as Gaia's own,
use three tools.
`GAIA_DATA_DIR=dir pnpm graph-snapshot [root]` writes the project's judged
graph from the answers in an app store. `pnpm jev-world` judges and composes
its world from that graph. `pnpm print-world-requests` prints the requests
without sending them. The tools keep their files in `~/.cache/gaia-snapshot/`
unless their arguments name other paths
([`snapshot-paths.ts`](../tools/snapshot-paths.ts)).

If a new primitive or schema change invalidates the showcase's bundled answers,
use the proving ground for visual coverage. For integration, open a checkout
in the app against the local stand-in, with a temporary store. Re-ask Jev for
the showcase ([showcase.md](showcase.md#update-the-bundled-worlds)) before
submitting changes that invalidate its answers.

Gaia keys saved Jev answers by request hash. Changing request state, wording or
options can invalidate them. Never relabel a saved answer as the answer to a
new request. Rejudge affected requests with approval before replacing a live
fixture bundle. Keep a snapshot's graph, judgments and design answers together.

## Sound files

The scripts in [`tools/sound/`](../tools/sound/README.md) make the files in
`app/renderer/sound/assets/`. `pnpm sound` rebuilds all of them,
`pnpm sound world` rebuilds the field recordings, and `pnpm sound music`
rebuilds the music. The scripts need [uv](https://docs.astral.sh/uv/), `curl`, and `ffmpeg`
with libopus. The first music build also compiles sfizz with CMake and Ninja.
The recordings, sample libraries and sfizz's source, about 3.5 GB, are
downloaded once into `~/.cache/gaia-sound/` and checked against the sums in
`tools/sound/sources.json`. Set `GAIA_SOUND_CACHE` to use another directory.

## Checks

```sh
pnpm check
pnpm exec tsx tools/cargo.ts test
pnpm exec tsx tools/cargo.ts clippy --all-targets -- -D warnings
```

`pnpm check` runs TypeScript, ESLint and Vitest. CI runs these and the Rust
checks on Linux, Windows and macOS, plus an Electron rendering probe on macOS.

The pre-commit hook checks types, lints changed TypeScript and JavaScript
files, and runs clippy when Rust changes. It runs no tests. Run relevant tests
during development and all checks before submitting a broad change. Fix
failures without bypassing the hook.
