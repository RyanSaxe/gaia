# Development

Start with the [README](../README.md) and [Jev setup](connect-jev.md).
The project uses Node 26, pnpm 10, Git and stable Rust from rustup. Install
`curl` as well; the engine uses it for OpenRouter requests and grammar downloads.
`pnpm engine` selects rustup's cargo through `tools/cargo-env.ts`.

## Run the app

`pnpm dev` builds the engine and starts Electron. Set `GAIA_JEV=live` and
`OPENROUTER_API_KEY` in your environment to judge a new codebase. Without live
access, Gaia can open bundled worlds or reuse a complete set of saved answers.

Set `GAIA_PROJECT` to a local project path to skip the start page, or to
`proving`, `showcase` or `showcase-fixed` for a bundled test world. Set
`GAIA_ENGINE` to use an engine binary at a different path.

Use the local stand-in described in [Jev setup](connect-jev.md#local-development)
when exercising requests without spending money or sending code to OpenRouter.

## The standalone lab

```sh
pnpm lab:html
```

Open `dist/lab.html` in a browser. It bundles the renderer, fonts and world
fixtures into one offline page. It has no engine connection and opens the
[showcase](showcase.md) unless a query names another world. The showcase opens
from its saved Jev answers; a missing answer fails with the request's name.

| Query | Use |
| --- | --- |
| `?world=proving` | Every supported visual feature, including ruin |
| `?world=showcase` | A small codebase with a mixture of healthy and poor code, the page's world with no query |
| `?world=showcase-fixed` | The same showcase with its broken module repaired |
| `?hour=22` | Pin the lighting to an hour |
| `?start` | Show the start page |
| `?sound=record` | Play nothing aloud; keep what the person hears for `__lab.sound.render()` |

Queries can be combined, for example `?world=proving&hour=22`.

`pnpm lab:serve` rebuilds and serves the page on the machine's Tailscale IPv4
address. It listens on port 5180 by default; set `LAB_PORT` to choose another
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

The hooks are defined in [terrain/hooks.ts](../app/renderer/terrain/hooks.ts),
[immersive/view.ts](../app/renderer/immersive/view.ts) and
[sound/index.ts](../app/renderer/sound/index.ts). Scripted Electron windows
call `webContents.setAudioMuted(true)`, so a run never plays through the
machine's speakers.
[shots.ts](../tools/shots.ts) is an example of driving the page.

## Visual verification

Use the [proving ground](proving-ground.md) to inspect every affected form at
vitality 1, 0.65 and 0.3, by day and at night. Also open Gaia's own checkout in
the app to catch changes that only appear in a large composition. The app keeps
Jev's answers for it in its own store after the first live open.

| Command | Result |
| --- | --- |
| `pnpm shots` | Captures all proving-ground stops into `shots/` |
| `pnpm shots willow` | Captures stops matching the supplied word |
| `pnpm shots sky` | Captures the first stop under each of the sweep's skies |
| `pnpm brand` | Regenerates the app's brand images and macOS icon |

For changes to frame cost or walking detail, compare before and after on a
quiet machine with `pnpm probe`. Its Electron window must remain uncovered.

| Probe | Measures |
| --- | --- |
| `pnpm probe drawn` | Frame time, draw calls and triangles by kind and pass |
| `pnpm probe steps` | Changes during walking with the wind frozen |
| `pnpm probe hitch` | Frame times and stutters during a walk |
| `pnpm probe swap` | Transitions between full geometry and baked far forms |
| `pnpm probe stress` | The proving ground with five times as many code trees |
| `pnpm probe paint` | Journal painting capture and rendering |

`--world showcase` or `--world proving` selects a world. `--spot` limits the
stops; `--dpr` sets the pixel ratio. The probes fail on WebGL errors. A timing
on a busy machine is not a reliable baseline.

## Components and fixtures

To add a primitive:

1. Declare it in `packages/primitives/src/` with pure geometry in `geometry/`.
   Fill every vitality channel and describe its closed parameters for Jev.
2. Register it in `library.ts`. Shared contract tests cover determinism,
   parameter ranges, channel ranges, triangle budgets and vitality response.
3. Regenerate the proving ground with `pnpm proving`. Its sky, lands,
   buildings, landmarks, trails, trees, bushes, stones and flowers are sweeps
   of the parts Jev composes them from (`sweep` in
   [`@gaia/world`](../packages/world/src/sweep.ts)), so a new part of one
   stands there with each of its options, thriving, tired and in ruin. The
   generator fails and names what is missing while the plan in
   `tools/proving.ts` has no place for it, such as an area with running water;
   add a directory to the plan then. A new part a tree, bush, stone or drift
   may grow from also needs words with a feel for every option, which
   `looks.test.ts` checks. Inspect the result in the app and screenshots.
4. Add an ink renderer in `app/renderer/immersive/marks.ts` if the primitive
   contributes to a building or landmark's map symbol.

The lab's fixture bundles live in `app/renderer/terrain/fixtures/`:

| Bundle | Source and regeneration |
| --- | --- |
| `proving*` | The made-up codebase planned in `tools/proving.ts` and the sweeps it stands; `pnpm proving` regenerates its facts and judgments. |
| `showcase*` | Source bundles, judged graphs and saved Jev answers for the [showcase](showcase.md). |

The repository keeps Jev's answers for the showcase only. To count what
composing another project's world asks and costs, such as Gaia's own,
`GAIA_DATA_DIR=dir pnpm graph-snapshot [root]` writes its judged graph from the
answers an app store holds, `pnpm jev-world` judges and composes its world from
that graph, and `pnpm print-world-requests` prints the requests without sending
them. They keep those files in `~/.cache/gaia-snapshot/` unless their arguments
name others ([`snapshot-paths.ts`](../tools/snapshot-paths.ts)).

If a new primitive or schema change invalidates the showcase's bundled answers,
use the proving ground for visual coverage and open a checkout in the app
against the local stand-in for integration. Use a temporary store for that run.
Re-ask Jev for the showcase ([showcase.md](showcase.md#update-the-bundled-worlds))
before submitting changes that invalidate its answers.

Saved Jev answers are keyed by request hash. Changing request state, wording or
options can invalidate them. Never relabel a saved answer as the answer to a
new request. Rejudge affected requests with approval before replacing a live
fixture bundle. Keep a snapshot's graph, judgments and design answers together.

## Sound files

The files in `app/renderer/sound/assets/` are made by [`tools/sound/`](../tools/sound/README.md):
`pnpm sound` rebuilds all of them, `pnpm sound world` the field recordings and `pnpm sound music` the
music. It needs [uv](https://docs.astral.sh/uv/), `curl`, and `ffmpeg` with libopus; the first music build
also compiles sfizz with CMake and Ninja. The recordings, sample libraries and sfizz's source are fetched
once into `~/.cache/gaia-sound/` (set `GAIA_SOUND_CACHE` to move it), about 3.5 GB, and checked against
the sums in `tools/sound/sources.json`.

## Checks

```sh
pnpm check
pnpm exec tsx tools/cargo.ts test
pnpm exec tsx tools/cargo.ts clippy --all-targets -- -D warnings
```

`pnpm check` runs TypeScript, ESLint and Vitest. CI runs these and the Rust
checks on Linux, Windows and macOS, plus an Electron rendering probe on macOS.

The pre-commit hook checks types and changed TypeScript files, and runs clippy
when Rust changes. It runs no tests. Run relevant tests during development and
all checks before submitting a broad change. Fix failures without bypassing
the hook.
