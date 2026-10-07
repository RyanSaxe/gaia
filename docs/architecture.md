# Architecture

Gaia passes plain typed data through four stages: the code model, the world
document, the realized world, and the screen. Jev writes only into the world
document, and only by answering questions Gaia derives from declared types.
The realizer turns the document into geometry as a pure function, so a part of
the document that did not change renders exactly as it did before.

## Data

| Data | Contents | Made by | Status |
| --- | --- | --- | --- |
| Code model | Per-path facts: language, size, symbols, imports, tests, git activity, diagnostics, content hash; and entities, with their files' facts summed | The Rust engine | Rebuilt from disk at any time |
| Vitality | A value from 0 to 1 per path and per entity, and the named signals behind it | A formula over the code model, plus named Jev signals | Recomputed live |
| World document | Regions, blueprints, instances, links and the world's art direction, as typed JSON | The world service, from Jev answers and layout, plus the person's edits | The world's source of truth, stored per project |
| Realized world | Meshes, terrain and material parameters | The realizer | A cache keyed by content hash |

## Processes

| Process | Language | Owns |
| --- | --- | --- |
| Main | TypeScript (Electron) | The window and the app's lifecycle. It starts the engine and the world service and restarts the engine if it exits. |
| Engine | Rust (`gaia-engine`) | Files, parsing, git, test reports, the code model, the app-data store and the Jev client with the key from the macOS Keychain. |
| World service | TypeScript (Electron utility process) | Kinds and primitives, the question planner, answer rules, vitality and the world document. |
| Renderer | TypeScript | The UI, the Three.js scene, the realizer and the clock. In slice 1 the renderer is the lab. The terrain lab bakes its world on worker threads (`app/renderer/terrain/bake-worker.ts`): a few workers compose bands of lattice rows with `composeRows`, and one finishes the bake with `finishTerrain` and stands the world's things on it with `standWorld` (`app/renderer/terrain/stand.ts`): each building's site and pad, the landmarks' sites, the trails leveled into the ground and which trail each ground sample lies on, the trees and the understory, and the ground texture's data, so drawing never waits on a bake. Components are still realized on the main thread; the realizer is pure and worker-safe, so it can move into workers too. |

The world service talks to the engine in newline-delimited JSON-RPC 2.0 over
the engine's stdin and stdout, relayed by the main process. Only small data
crosses: code facts, Jev requests and answers, and store records. Geometry
never crosses, because the renderer builds it. `EngineMethods` in
`packages/schema/src/engine.ts` is the TypeScript side of the protocol, and
`engine/src/rpc.rs` the Rust side. The engine answers `engine.ping`,
`project.open`, and Jev's `jev.estimate`, `jev.ask` and `jev.batch`.

`project.open` walks a directory, respecting `.gitignore`, and reports each
file's facts, the entities, and the repository (`CodeModel`). Each file is
read by a careful line-based pass for TypeScript, JavaScript and Rust
(`engine/src/source.rs`), with a small lexer that keeps strings and comments
apart from code: its language and kind (source, test, config, data, docs,
script), lines, leading comment, exported symbols with their doc comments,
imports, a rough complexity and its TODO markers. Imports resolve relative
paths, workspace packages by name through their `exports`, and Rust `mod`
declarations. A test covers every file it reaches through imports; a crate's
integration tests reach its entry, and a Rust file with a `#[cfg(test)]`
module covers itself. Entities come from `package.json` and `Cargo.toml`, from
directories whose index file is no package's entry (modules), and from
directories with a `main` or `server` file (apps and services). An entity
depends on another through its manifest or when one of its files imports one
of the other's. History comes from one `git log`. Nothing runs the compiler,
the linter or the tests yet, so diagnostics and failing tests read 0, and
nothing watches the project for `facts.changed`. On Gaia's own repository
(about 220 files, 33,000 lines) `project.open` takes about 70 ms in a release
build.

## Packages

| Package | Contents | Imports |
| --- | --- | --- |
| `@gaia/schema` | The type builder, ports and vitality channels, primitive and kind contracts, code facts, the world document, Jev's wire format, the engine protocol, content identity | Nothing |
| `@gaia/primitives` | Primitive declarations and geometry, palettes, the manifest `PRIMITIVES` | schema |
| `@gaia/kinds` | The flora, structure, rock, wildflowers, landmark, link, biome and world kinds | schema |
| `@gaia/world` | The question planner, answer rules, context gathering, file and entity vitality, type-space tools, `WorldChange`, and the world laid out from code: the requests Jev answers about it, the stand-in judge and the layout | schema |
| `@gaia/realize` | Blueprint to parts, world and region looks at an hour, the light between a day's keys, the sky and air references, presets, channel math, detail by distance | schema, primitives |
| `@gaia/render` | Three.js materials, light and shadow, and instanced copies of a component, culled by cell and thinned by distance | schema, realize, three |
| `@gaia/terrain` | Relief composition, the baked heightfield, water, the wild land past the rim, walking, wading and swimming, the solids that stop a walk and the way around them, sight lines, where plants, the understory and landmarks stand, the routes of trails, and where a person is (`placeAt`) | schema, primitives, realize |
| `@gaia/app` | Electron main, preload, world service, and the renderer (the lab) | Every package |

ESLint enforces these boundaries and the purity rules; `eslint.config.js`
gives the reason next to each rule.

## The schema

A **primitive** is a pure procedural function with typed parameters and a
role, such as `branching@1` (Skeleton) or `leaf-clumps@1` (Foliage). It is code,
versioned in its ID. A **kind** declares slots by role and the subject it
stands for: a file (`flora`, `rock`, `wildflowers`), an entity
(`structure`, `landmark`), a region (`biome`), a dependency between two
entities (`link`) or the repository (`world`). A `link`'s blueprint fills only a trail's look; the
terrain finds its route. A `structure`'s footprint lays out one
`BuildingPlan`: the masses the building is joined from (each a block or a
round turret with its own storeys and roof form: gable, hip, half-hip,
lean-to or cone), its floor, and where every door and window goes. Its body,
roof, openings, ornaments and optional feature (a `waterwheel@1`, a
`tower@1`) each build on that plan, so walls rise to the roofline over them
and everything agrees by construction. The geometry lives in
`packages/primitives/src/geometry/building/`, one file per part: layout,
frame (reading the plan), walls, roofs, openings, garden, ruin and features.

An **entity** is a named unit of the code with a boundary, a public surface,
things that depend on it and a health of its own: a package or crate (found
from its manifest), a service or app (from a binary or server entry point),
or a module (a directory whose index file gives it a public surface).
`EntityFacts` in `packages/schema/src/facts.ts` is what the engine will
report for each: its root path (its identity), name, form, manifest, entry,
doc, size, exports, the entities it depends on and that depend on it, and
its files' tests, diagnostics and git activity summed. Entities nest; each
file belongs to its innermost one. Buildings and landmarks stand for
entities, plants for files, and trails for dependencies between entities.
Jev decides which entities become buildings, which become landmarks and
which form suits each, with no rule fixing how many of either; the kinds
bind only numbers from the facts (a building's size from lines, storeys from
exports and a feature's reach from dependents; a landmark's scale from its
dependents; a trail's traffic from how many of one entity's files import the
other). `DependencyFacts` carries both entities' facts, so a trail can follow
the vitality of each.
A **blueprint** fills a kind: a primitive for each slot and a stored value for
each parameter. An **instance** places a blueprint for one path. Jev
generates blueprints and instances; people and agents write primitives and
kinds.

Every parameter is a closed set: a choice, a scale of described levels, a
flag or a set. A blueprint stores the words Jev chose. A primitive's `build`
receives numbers, which the seed picks between neighboring levels, so
instances of one blueprint vary and each is identical on every run.

## A world from code

`@gaia/world` turns a code model (`CodeModel`, what `project.open` returns)
into a world document (`CodeWorld`, in `packages/world/src/code-world.ts`).
The repository is the world. Each directory is an area, a circle of ground
nested inside its parent's. Each file is a patch inside its directory's area,
its size set by its lines (2.5 m² a line, capped at 1,200 lines). Each entity
stands on a lot in its root directory's area, as a building or a landmark.
A dependency between two entities that Jev would walk becomes a trail
request. `layoutWorld` packs a directory's lot first, then its files, then
its subdirectories' areas around them, and fits each in its smallest circle,
so the world's side grows with the code (Gaia's own is 1.3 km). A directory
whose own lines, with those of subdirectories that have no land of their
own, reach 3% of the code gets its own land: a terrain region centered on
its files, reaching as far as their ground (`RegionSpec.reach`, which weighs
the borders between regions). Smaller directories are areas on their
parent's land.

Jev judges every look: the repository's art direction, each region's land,
what grows on each file's patch, whether each entity is a building or a
landmark and which, and which dependencies become trails and how they look.
`planWorldRequests` builds one request per thing, from facts and doc
comments only, with options shuffled by the thing's path. `judgeWorld` asks
them through any `JevClient`, eight at a time. Until the reviewer approves
live calls, `standInJev` answers: a deterministic stand-in that scores each
option by the fact tags its look suits, with a tie-break seeded by the
question. `engineJev` in the world service is the live client; swapping it in
is one line in `app/renderer/terrain/code-world.ts`.

`placeAt(world, x, z)` in `@gaia/terrain` says where a person is: the
deepest area whose circle holds the point and the file patch underfoot, if
any (`WorldPlaces`, in `@gaia/schema`). Past every area is the repository's
own wild land.

The terrain lab's "This codebase" button (or `?world=code`) shows Gaia's own
world from `app/renderer/terrain/fixtures/gaia.json`, a snapshot `pnpm
snapshot` writes through the engine's `project.open`. `standWorld` takes the
layout (`StandRequest.code`): each building and landmark on its lot, trees of
the chosen species on each file's patch with that file's vitality, and the
trails between lots. The ground textures take a world of any size.

## Jev

Jev answers three question types about one JSON state: `choice` (up to 255
options), `score` (2 to 10 described levels) and `noul` (the probability that
a statement is true). It cannot return text, free numbers or objects, and its
answers can vary between identical calls. Gaia therefore:

- plans a blueprint in two requests, structure and then details, so details
  agree with the structure; kinds with `stages` answer in more;
- shuffles each choice's options by the target's path, because Jev leans
  toward the first option;
- grows the context only where Jev is unsure, adding the readings Jev asks for
  (`gather` in `packages/world/src/context.ts`);
- stores every accepted answer, keyed by the question, the pinned model and
  the coarse facts it reads, and asks again only when those facts change;
- keeps a stored answer unless a fresh one wins by a margin (`reconcile`).

The engine is Jev's only client (`engine/src/jev.rs`). It posts each request
to OpenRouter's Decisions API with curl, the key read from the macOS Keychain
(service `gaia-openrouter`) and handed to curl on stdin, never on a command
line or over the protocol. `jev.batch` sends many requests eight at a time;
`jev.ask` sends one. Both refuse unless the engine runs with `GAIA_JEV=live`.
`jev.estimate` returns what a batch would send and cost without reading the
key or touching the network: tokens are estimated at 1.8 bytes each, from
OpenRouter's published example, and priced at Jev 1.13's $0.042 per million
input tokens (output is free). `pnpm print-world-requests` prints every
request judging Gaia's own world would make, with that estimate.

## Vitality

Vitality multiplies penalties from named signals, each with a weight:
failing tests, compiler errors, complexity, untested code, lint warnings,
unused code, debt markers, and named Jev judgments. An entity's signals read
the same facts as shares of the whole (`entityVitalityOf`), so one failing
test in a large package costs less than half its tests failing. Each term
carries a reading in words, such as "2 of 4 test files failing", for the
card that tells a person what a thing is. Activity, from recent commits, is
a separate channel that never lowers vitality.

Every primitive writes five per-vertex vitality channels: `loss` (the vitality
below which a piece collapses to its pivot), `droop`, `wither`, `glow` and
`pivot`, plus a `tint` hue offset, a `cutout` that places a vertex on a
leaf card, and `close`, how far a piece folds toward its pivot at night (a
flower's petals). Parts may add four optional channels for ruin and motion:
`fall` (an axis, the most it turns, and the vitality below which a piece tips
about its pivot: a door swings ajar, a chimney topples), `grow` (the vitality
below which a piece grows out of its pivot: ivy, weeds, rubble, boards over
windows), `rot` (how far a surface rots through into ragged holes, cut per
fragment from a noise fixed to the piece) and `spin` (an axis and a rate a
piece turns at while alive, slowing to a stop as vitality falls: a mill's
wheel). A part without them carries none, and only its material compiles
them in. The plant shader combines them with each instance's live
vitality, so a change in vitality never rebuilds geometry. A component placed
many times, such as a tree, a rock or a drift of flowers, draws as one
instanced mesh per part and level of detail, with each copy's vitality, seed
and hue read per instance and its shape varied a little by where it stands.
`applyVitality` in `packages/realize/src/channels.ts` is the CPU reference the
tests run against.

## Detail

Every part also carries `piece`: the connected run of triangles each vertex
belongs to (one leaf card, one limb, one petal) and that piece's size.
`PartBuilder` writes it, so every primitive has it without work of its own.
Distance thins detail by whole pieces, from the person's eye in every pass:
`pieceReach` and `detailAt` in `packages/realize/src/detail.ts` are the rule
and the CPU reference, and the plant shader applies the same numbers. A
coarser level of detail is the full build with the pieces that have left by
its distance taken out, every kept vertex bit-identical, so detail is computed
from one build and never shifts a primitive's random streams.

`createPlantInstances` in `@gaia/render` sorts copies into 32 m cells. Before
each pass (the sun's shadow, the water's mirror, the view) the scene's
`onBeforeRender` calls `cull` with that pass's camera, which packs only the
cells the camera sees into each level's instance buffer. A cell draws a
coarser level only when its nearest point is past that level's distance, where
every piece the level leaves out has already left on screen, so the two draw
the same pixels.

## Time

A world's hour is the person's local time. Only the renderer reads the clock
(once a minute); it passes the hour to `lightAt` and `realizeWorld` in
`@gaia/realize`, which stay pure functions of it. The Light role's output is
a `DaySpec`: the light at each key hour, with the world's moon and stars.

## Continuity

- Everything between the engine and the renderer is serializable typed data,
  so Gaia can store it, diff it and hash it.
- A world item's identity is its project-relative path; a rename is a removal
  plus an addition. Seeds come from paths.
- A blueprint's ID is a hash of its contents, so equal answers name the same
  blueprint.
- Reopening a world loads the stored document and asks Jev only about stale
  answers.
- The world service will emit a `WorldChange` for every document patch, so
  notes about changes can be added later as one more listener. Nothing emits
  it yet.
