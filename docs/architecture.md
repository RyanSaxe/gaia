# Architecture

Gaia turns a repository snapshot into a typed `WorldDocument`, then builds
terrain and geometry from that document. Jev has two separate jobs: judging
importance and quality, and choosing the world's appearance.

## Data flow

![Gaia's data flow from repository through code analysis and world design to the renderer](images/architecture-data-flow.svg)

The Rust engine builds the `CodeGraph` and has the only OpenRouter client. The
world service derives facts and plans world design questions. Both Jev paths
use typed requests and reuse answers saved by request hash. The renderer
receives the finished `WorldDocument`, and the pure world packages build all
of its geometry.

### The two Jev paths

| | Code understanding | World design |
| --- | --- | --- |
| Planned by | Rust engine | TypeScript world service |
| Questions | How important is each part? How healthy is it? Which code links resolve? | Which eligible parts and settings fit this code, region or dependency? |
| Results | Importance, quality, selected code spans and resolved graph links | Choices of kinds, primitives and typed settings for the land, sky and things |
| Used by | Vitality, code facts and world layout | Blueprints in the `WorldDocument` |

Code understanding is defined in `engine/src/jev/` and
`engine/vocab/understanding.toml`. World design uses the kinds and primitive
schemas in `packages/kinds` and `packages/primitives`, with planning in
`packages/world`. Jev can choose only the options those schemas offer. Code
supplies coordinates and measurements, and pure packages build the geometry.

## Code understanding

The engine reads a committed Git tree, or the working directory when no
committed tree exists. Tree-sitter queries build a graph of directories, files,
definitions and blocks. Containment and code links describe how they connect.
Language grammars and resolution rules are configured in
[`engine/languages.toml`](../engine/languages.toml) and
[`engine/queries/`](../engine/queries).

The link pass asks Jev to resolve each uncertain reference among its
candidates. The understanding pass then judges folders from parent to child,
and files after their folders. Requests carry the project's description and
surrounding code. The engine splits a file too large for one request at its
top-level definitions, so no source is trimmed away.

Importance and quality are separate. Importance controls which forms and sizes
are offered to an item. Quality becomes its vitality. Jev judges definitions
for correctness, readability, simplicity, cohesion, coupling, explicitness,
consistency, testability, robustness and efficiency. A container's quality
combines its own criteria with its contents. The levels, weights, excluded
data roles, and key and weak block selections are defined in
[`understanding.toml`](../engine/vocab/understanding.toml).

The engine stores raw responses by request hash and held judgments by code
lineage. A repeated request reuses its stored response
([`runner.rs`](../engine/src/jev/runner.rs)). A fresh answer replaces a held
judgment only when it clearly differs, which keeps judgments stable through
edits and renames ([`hold.rs`](../engine/src/jev/hold.rs)).

## Runtime boundaries

![Electron processes, the Rust engine, OpenRouter, and the repository and project store](images/architecture-runtime.svg)

Electron's main process starts the world service, renderer and engine. It
relays engine calls over newline-delimited JSON-RPC. The service sends the
renderer its document and progress over a `MessagePort`. These boundaries are
declared in `app/world-service/protocol.ts` and `packages/schema/src/engine.ts`.

Sound runs only in the renderer, in `app/renderer/sound/`. Each frame,
`WorldHandle.earshot()` reports what the person can hear where they stand, and
the sound module turns that into Web Audio levels. The pure packages have no
sound code. The module decodes a recording only while it may be heard, and
decodes the music one 4-bar chunk at a time just before it plays. The same
Web Audio graph renders a recorded walk offline.

## Packages

The diagram lists each package's role and direct imports.

![Gaia package roles and direct dependencies](images/architecture-packages.svg)

`schema` defines the contracts shared across packages. `kinds` declare the
components of a world and the roles each one has, and `primitives` implement
the parts that fill those roles. A blueprint records a kind, its chosen
primitives and their typed settings. `world` plans and composes blueprints.
`terrain` shapes the land, places things on it and moves the person across it.
`realize` turns blueprints into parts, and `render` draws them.

The world, terrain, kinds, primitives and realize packages are pure: no DOM,
clock, filesystem, `Math.random` or Three.js. `eslint.config.js` enforces their
import and purity rules. The app connects those packages to Electron, workers
and the renderer.

## Composing a component

A kind declares slots by role, such as a building's footprint, walls, roof and
openings. A primitive implements a role, declares closed parameters and builds
pure geometry. Its requirements can restrict where it is offered, such as a
waterwheel's need for running water.

The planner first asks Jev which primitives fill the slots, then asks for
their settings in stages. Each stage's request includes the earlier choices.
The resulting blueprint contains identifiers and typed values. It contains no
model-generated code, shaders or coordinates, so geometry and placement stay
deterministic.

Every building, landmark, tree, bush, stone and drift of flowers that
represents code is composed this way. Jev first chooses each thing's form from
the forms its importance allows (`FORMS` and `SIZES` in
[`looks.ts`](../app/renderer/terrain/looks.ts)). A tree, bush, stone or flower
form fixes the part a person sees first, such as a weeping tree's frame,
without asking Jev. Jev composes the rest from the parts offered for that size
alone, so a bush is never offered a tree's frame. Trees, bushes, stones or
drifts with identical answers share one build, seeded by the blueprint's
content. The renderer rotates and scales each copy of a build and tilts it to
its ground's slope. Each distinct build bakes its own far form. A landmark's
build is seeded by its path, so two landmarks with identical answers still
differ in shape within what their answers allow.

The GPU keeps a fixed number of far forms at once, whatever the world's size
(`FAR_SLOTS` in [`woods.ts`](../app/renderer/terrain/woods.ts)). The slots go
to the builds with the most copies that the person's view would draw far.
Every copy of any other build draws its full form. When a build gets a slot,
the renderer reads its far form from the browser's far-form store if an
earlier visit baked it, and otherwise bakes and stores it. The first world
waits only for the far forms that fill the slots at its opening spot. After
the world shows, a build that gains or loses a slot moves its copies' swap
size up or down over many frames
([`far-stream.ts`](../app/renderer/terrain/far-stream.ts)). Each copy then
passes through the same band as when a person walks away from it. Each set of
cards draws in one batch from texture arrays. These hold each far form as it
was baked, at every mip level a card reads, with the form's droop field.

The wild is the ground past the land's edge, and it represents no code. Jev
composes its bushes too, one for each of the wild's two ground covers
(`WILD_GROUNDS` in [`looks.ts`](../app/renderer/terrain/looks.ts)). Each uses
a bush's parts, with questions worded for the wild
(`wildBush` in [`bush.ts`](../packages/kinds/src/bush.ts)). Each request
includes its ground cover and the world's sky and lands as Jev composed them,
and nothing about the code (`wildState` in
[`compose.ts`](../packages/world/src/compose.ts)). Jev chooses its colors from
the lands' native families. Every thicket in the wild uses the bush of the
ground it grows in.

A primitive writes channels for health and motion as it builds. Shared shaders
apply vitality and time to those channels, so a change in health can alter
foliage or ruin without rebuilding geometry. The
[design guide](design-system.md) describes those visual rules.

## Opening a world

1. The engine reads a snapshot and builds a graph of directories, files,
   definitions and code links. In a Git repository with commits, the snapshot
   is the committed tree, and uncommitted edits do not enter the world.
   Without a committed tree, Gaia reads the disk and skips ignored files.
2. The engine asks code-understanding questions for importance, quality and
   code links. The world service derives facts from the graph and asks its
   separate design questions. The final design uses the judged graph.
3. The world service composes typed answers into a `WorldDocument` and lays
   out its regions, things and paths.
4. Pure packages turn the document into terrain and geometry. The renderer
   builds and draws the result.

Gaia stores Jev's answers per project by request hash, so the next opening
reuses the answer to an unchanged request. Gaia stores the answers, not the
complete `WorldDocument`.

## Laying out the land

The land's division depends on the code alone, never on Jev's answers
([`land.ts`](../packages/world/src/land.ts)). A folder's land is divided among
its subfolders and its own ground, which holds its files and its entity's
lot. Each part's share is proportional to its ground, which comes from its
lines and definitions. The division repeats down to every file and, within a
file's patch, every definition. Each division is a power diagram on a raster
of the land. Every part has a site and a weight. The site starts at a point
seeded from the part's path and moves to the centroid of the part's cells,
which makes the parts round. The weight is solved so the part's area matches
its share.

Most edits leave the land unchanged. Every file's and folder's ground rounds
up to the next rung of a scale whose rungs are 25% apart, and the land's size
follows the rung of the whole code's ground. An edit that moves no ground
across a rung leaves the land exactly as it was. An edit that does re-divides
the folder whose share changed, and the borders around it shift. A change in a
top-level folder's share moves most of the world a few meters. A directory
gets a landform of its own when its lines reach the rung nearest 3% of all
lines (`LAYOUT.regionShare` in
[`code-world.ts`](../packages/world/src/code-world.ts)).

## Changes to an open world

![How an open world responds when a commit changes the code graph](images/architecture-updates.svg)

A commit can leave the land as it was, because its lines shift and its files
grow without crossing a rung. Then the open world moves to the new commit and
updates its code judgments, its vitality and each definition's line span,
which the journal shows. A commit can instead move the land, or add or remove
a file or definition. Then Gaia keeps the current layout and forms, updates
vitality for things that still match by ID, and shows the new layout and forms
on the next open. `refreshWorld` in `app/world-service/open-world.ts` implements
this.

## Where to look next

- [Development](development.md): commands, fixtures and verification.
- [Connecting Jev](connect-jev.md): key, estimates and spend limits.
- [Design system](design-system.md): how components and vitality look.
- [`packages/schema`](../packages/schema/src): engine, world and Jev contracts.
- [`app/world-service/open-world.ts`](../app/world-service/open-world.ts): opening and updating a world.
- [`engine/src/jev`](../engine/src/jev): code understanding and the OpenRouter client.
