# Gaia

Gaia turns a codebase into a world a person wanders through. Jev fills typed
schemas from code facts; primitives turn the filled schemas into geometry;
vitality shows code health everywhere. Read `docs/architecture.md` before
changing structure and `docs/design-system.md` before changing how anything
looks; `docs/decisions/` says why each was decided.

## Rules

- Primitives, kinds, the world package, the realizer and terrain are pure: no
  `Math.random`, no clock, no DOM, no files, no Three.js. Lint enforces it.
- Every field Jev answers is a closed set with an instruction. Scale levels are
  words. Free text, free numbers and coordinates come from code, never Jev.
- Primitives write vitality channels and pick a swatch. They never ship GLSL.
- Kinds name roles, never primitives, so Jev can choose any primitive that fits.
- Every component responds to vitality through its channels, so a change in
  vitality never rebuilds geometry.
- Nothing may appear, vanish or change shape perceptibly as the person moves,
  and nothing on screen may remind them it is an app: no labels floating in
  the world, no click rings, no status text. Effects stay subtle.
- Until Gaia stores worlds for real people, change primitives in place and
  keep them at `@1`: look and feel will change a lot first. Once worlds are
  stored, a change to a primitive's look or parameters becomes a new version
  (`branching@2`), and stored worlds keep the old one until a person migrates.
- The visual bar is v1's components and Breath of the Wild.
- Never send anything to OpenRouter without the reviewer's approval. Prove a
  live path against the local stand-in (below).

## Running

You need Node 26, pnpm 10 and a stable Rust toolchain from rustup (put
`~/.cargo/bin` first on `PATH`; Homebrew's rustc is not used).

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs dependencies and points git at `.githooks/` |
| `pnpm dev` | Builds the engine and opens the app on the start page; `GAIA_PROJECT=/path` opens that folder's world, and `GAIA_PROJECT=proving` the proving ground |
| `GAIA_JEV=live pnpm dev` | The same, with Jev judging through the Keychain's key (`docs/connect-jev.md`) |
| `pnpm lab:html out.html` | The lab as one offline page, on Gaia's own world with Jev's kept answers |
| `pnpm lab:serve` | That page on this Mac's Tailscale address, port 5180, rebuilt on every change |
| `pnpm shots` | Screenshots of every primitive and world look, from Electron |
| `pnpm readme-shots` | The README's two screenshots, into `docs/images/` |
| `pnpm snapshot` | Rewrites `app/renderer/terrain/fixtures/gaia.json`, the code model the standalone lab shows |
| `pnpm proving` | Rewrites the proving ground's fixtures (`docs/proving-ground.md`) |
| `pnpm probe` | Measures both worlds in Electron: frame time, triangles by kind and pass, the walk test and smoothness |
| `pnpm jev-world`, `pnpm compare-jev`, `pnpm print-world-requests` | Jev's kept answers for the snapshot, request designs compared, and every request printed |

The lab page takes `?view=terrain|flora|world` (a debugging view instead of
the world), `?hour=22`, `?world=sample`, `?world=proving`, `?judge=stand-in`
and `?start=table|signpost`. Scripts drive it through `window.__lab`:
`open(view)`, `hour(h)`, `frames(n)`, `stats()`, and each view's hooks, such
as `__lab.terrain.walk(x, z, yawDeg, pitchDeg)`, `__lab.terrain.calls()` and
`__lab.immersive.map(true)`, listed where each lab returns them.
`tools/readme-shots.ts` is a short example.

Test a change in the proving ground (`?world=proving`) as well as in Gaia's
own world. It is a made-up codebase whose world holds every feature, from
thriving to ruin: `__lab.terrain.tour()` lists its stops and
`__lab.terrain.tour("ruined bridge")` walks to one (`docs/proving-ground.md`).

Measure a change that could cost frame time, or change what a step of
walking shows, with `pnpm probe` before and after, on a quiet machine. It
opens Gaia's own world and the proving ground in the app's own Chromium and
reports:
- each spot's frame time, with draw calls and triangles by kind (trees,
  understory, grass, ground and so on) and by pass (the view, the water's
  mirror and the sun's shadow);
- the walk test: walking toward the woods with the wind's clock frozen, what
  each step changes in the detail drawn, against the wind's own change over
  half a second. A step that changes more than the wind, and enough to see,
  is a pop;
- the app's smoothness probe over a real walk: median, 99th percentile and
  stutters;
- a world with five times the trees (`pnpm probe stress`).

Its window opens without taking focus; leave it uncovered while it runs.

To prove a live Jev path without spending anything, run the local stand-in
and point the engine at it. The engine accepts only a loopback endpoint and
never reads the Keychain for one:

```sh
pnpm openrouter-stand-in --port 8787
GAIA_JEV=live GAIA_JEV_ENDPOINT=http://127.0.0.1:8787/api/alpha/decisions GAIA_DATA_DIR=/tmp/gaia-data pnpm dev
```

## Working in parallel worktrees

Several agents often work at once, each in its own git worktree on its own
branch. Four sessions own the parts of Gaia; `docs/sessions.md` says who owns
what, how work merges into `main`, and how each worktree keeps the current
world. Read it before you change anything outside your session's area.

- Create the worktree from the branch you were given, then run
  `pnpm install` inside it. Each worktree has its own `node_modules` and its
  own `target/`, so the first engine build in it takes a minute or two.
- Port 5180 (`pnpm lab:serve`) serves `main` to the reviewer's phone; leave it
  alone. Each session has its own port in `docs/sessions.md`. See your work with `pnpm lab:html` and
  open the file instead.
- Stop only the processes you started, by their PIDs.
- The machine is shared, so timings are noisy: say so when you report frame
  times, and measure before and after under the same load.
- Stay inside your task's files. When you must touch a shared one (the
  terrain lab, `docs/architecture.md`, `docs/design-system.md`), keep the
  change small and list it for whoever merges.

## Contracts

These are the seams the parts meet at. Change one only on purpose, update its
doc in the same commit, and say so in the commit message.

- **Engine protocol**: `EngineMethods` in `packages/schema/src/engine.ts` and
  `engine/src/rpc.rs`, newline-delimited JSON-RPC.
- **World service and page**: the messages in `app/world-service/protocol.ts`
  (`world.open`, `world.progress`, `world.start`, `world.choose`,
  `world.consent`, `world.document` and the rest).
- **Packages**: each package's `src/index.ts` is its public surface, and the
  imports allowed between packages are in `eslint.config.js`. Tests import
  only these.
- **Primitives**: `Primitive` in `packages/schema/src/primitive.ts`: closed
  parameters, a pure `build`, every vitality channel written. Adding one is
  below.
- **The world from code**: `planWorldRequests`, `judgeWorld`, `keptJev`,
  `landOf` and `layoutWorld` in `@gaia/world`; `bakeTerrain`, `placeAt` and
  `outlinesOf` in `@gaia/terrain`; `standWorld` in
  `app/renderer/terrain/stand.ts`.
- **Fixtures**: the standalone lab shows `fixtures/gaia.json` (a snapshot of
  this repository) judged by `fixtures/gaia-jev.json`. Regenerate them
  together, since Jev's kept answers are keyed by each request's hash. The
  proving ground's `fixtures/proving.json` and `proving-judged.json` come
  from `pnpm proving`; its test fails when a new option in `looks.ts` is
  missing from them, or when its world loses a feature.

## Adding a primitive

1. Declare it in the file for its kind (`flora.ts`, `relief.ts`, `biome.ts` or
   `world.ts` in `packages/primitives/src/`), with its geometry in `geometry/`.
   `build` is pure and writes every vitality channel.
2. Add it to `PRIMITIVES` in `packages/primitives/src/library.ts`. The contract
   tests then check its doc, determinism, channel ranges, triangle budget and
   vitality response.
3. Open the lab, use the primitive at vitality 1, 0.5 and 0.1, and watch it
   move in the wind. Run `pnpm shots` and attach the images for review.

## Tests

- Test behavior through a package's entry point (`@gaia/<name>`), never its
  internals. Lint enforces this.
- Prefer extending a contract test, which covers every primitive or kind at
  once, over writing a test for one of them.
- Name each test for the behavior it protects. Delete a test that only
  restates the implementation.
- Never use snapshot assertions. Lint enforces this.
- Bake a world once per file and share it; work on a `structuredClone` when a
  test changes it. A test that still takes about a second alone gets an
  explicit timeout with the reason beside it, because other work shares the
  machine.
- The tests run without V8's Maglev compiler; `vitest.config.ts` says why.

## Checks and commits

`pnpm check` runs the type checker, the lint rules and every test.
`cargo test` and `cargo clippy --all-targets -- -D warnings` cover the
engine. CI (`.github/workflows/check.yml`) runs all of them on every push and
pull request, and a pull request merges only once CI passes. The pre-commit
hook stays quick, because several worktrees share one machine: it checks the
whole project's types incrementally and lints the changed files, and lints
the engine when the engine changed. It runs no tests. While you work, run the
tests your change touches (`pnpm vitest run packages/terrain`, say, or
`cargo test`), and run `pnpm check` before opening a pull request when the
change is broad. Commit through the
hook, with rustup's toolchain first: `PATH="$HOME/.cargo/bin:$PATH" git commit`. Fix a failing
check; never silence it or skip the hook. Make each commit one coherent step,
and keep scratch scripts, logs and screenshots out of the repository.

## Docs

Update `docs/architecture.md` or `docs/design-system.md` in the same commit as
a change that alters them. Record each decision settled in a pair session in
`docs/decisions/`, with a link to its round, and add it to that folder's
README.
