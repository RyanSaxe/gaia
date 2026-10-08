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
| Main | TypeScript (Electron) | The window and the app's lifecycle. It starts the engine and the world service, restarts the engine if it exits, and names the folder whose world each page opens: Gaia's own repository, `GAIA_PROJECT`, or one chosen with File > Open Folder. |
| Engine | Rust (`gaia-engine`) | Files, parsing, git, test reports, the code model, the app-data store and the Jev client with the key from the macOS Keychain. |
| World service | TypeScript (Electron utility process) | Kinds and primitives, the question planner, answer rules, vitality and the world document. It opens a codebase's world (`openWorld` in `app/world-service/open-world.ts`): the engine's `project.open`, Jev's judgments, kept in the store, and `layoutWorld`, and sends the renderer the result (`WorldDocument`) over its MessagePort. |
| Renderer | TypeScript | The UI, the Three.js scene, the realizer and the clock. In slice 1 the renderer is the lab. The lab opens into the world, full screen at eye height (`app/renderer/immersive/`), with its debugging views (Components, Terrain and Skies) behind tabs; the immersive world is the terrain lab's world without its chrome, plus three ways of telling a person where they are (arrival titles, a field map and markers in the world), read through `placeAt`; touching the world only moves the person, and everything else opens from the corner controls (`docs/design-system.md`); a tap on the open field map sends the person to that place, landing where `WorldHandle.landing` says, under a fold of paper that hides the move. The terrain lab bakes its world on worker threads (`app/renderer/terrain/bake-worker.ts`): a few workers compose bands of lattice rows with `composeRows`, and one finishes the bake with `finishTerrain` and stands the world's things on it with `standWorld` (`app/renderer/terrain/stand.ts`): each building's site and pad, the landmarks' sites, the network of trails leveled into the ground and which way of it each ground sample lies on, the trees and the understory, and the ground texture's data, so drawing never waits on a bake. Components are still realized on the main thread; the realizer is pure and worker-safe, so it can move into workers too. |

The world service talks to the engine in newline-delimited JSON-RPC 2.0 over
the engine's stdin and stdout, relayed by the main process. Only small data
crosses: code facts, Jev requests and answers, and store records. Geometry
never crosses, because the renderer builds it. `EngineMethods` in
`packages/schema/src/engine.ts` is the TypeScript side of the protocol, and
`engine/src/rpc.rs` the Rust side. The engine answers `engine.ping`,
`project.open`, Jev's `jev.estimate`, `jev.status`, `jev.ask` and
`jev.batch`, and the app-data store's `store.get`, `store.read` and
`store.put`. The store (`engine/src/store.rs`) keeps one JSON file of tables
per project, `<data>/projects/<project id>/store.json`, replaced through a
rename so it is never half-written; `<data>` is the app's user-data folder,
which main passes as `GAIA_DATA_DIR`.

`project.open` walks a directory, respecting `.gitignore`, and reports each
file's facts, the entities, and the repository (`CodeModel`). Each file is
read by a careful line-based pass for TypeScript, JavaScript and Rust
(`engine/src/source.rs`), with a small lexer that keeps strings and comments
apart from code: its language and kind (source, test, config, data, docs,
script), lines, leading comment, symbols (every exported one, and the
top-level functions and classes it keeps to itself, with `exported: false`),
each with its doc comment, the line it is declared on and how many lines it
spans, imports, a rough complexity and its TODO markers. Imports resolve relative
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
| `@gaia/world` | The question planner, answer rules, context gathering, file and entity vitality, type-space tools, `WorldChange`, and the world laid out from code: the code graph, the requests Jev answers about it, the stand-in judge, the division of the land and the layout | schema, terrain (the land's division rule) |
| `@gaia/realize` | Blueprint to parts, world and region looks at an hour, the light between a day's keys, the sky and air references, presets, channel math, detail by distance | schema, primitives |
| `@gaia/render` | Three.js materials, light and shadow, and instanced copies of a component, culled by cell and thinned by distance | schema, realize, three |
| `@gaia/terrain` | Relief composition, the baked heightfield, water, the endless wild land past the rim and the ground's height anywhere, walking, wading and swimming, a walker's gait (easing, grade, the eyes' ride over the ground and footbridge decks), the solids that stop a walk and the way around them, sight lines, where plants, the understory and landmarks stand, the routes of trails, how land divides into cells (`siteAt`), and where a point is (its area and the file underfoot, `placeAt`, and every area's and patch's outline, `outlinesOf`) | schema, primitives, realize |
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
into a world document (`CodeWorld`, in `packages/world/src/code-world.ts`) in
three steps: code to graph, graph to land, and Jev's meaning on top.

**The graph.** `codeGraph` builds one graph from the facts: directories
contain directories and files, files contain their finer entities
(functions, classes, types and constants, each with its size and doc
comment), and entities are rooted at directories. Edges say what contains
what, which file imports which, and which entity depends on which, weighed by
how many of its files import the other.

**The land.** `layoutWorld` lays the graph out as land with `divideLand`
(`packages/world/src/land.ts`). Each directory's land is divided among its own
ground (its files and its entity's lot, kept together at its heart) and its
subdirectories, each in proportion to its code (26 m² a line, weighed by the
part the file plays: code most, configuration and data least); then each of
those is divided the same way, down to the files. Every division is a
relaxed, weighted nearest-site division of a raster of the land, starting
from spots seeded by each child's path, so the same code gives the same land
and a small change moves it a little. The divisions are measured from points
moved by the land's warp (`warpPoint`, a broad sway and a fine one), so
borders curve and wander like fields' and nothing is a circle or a square.
The land fills the walkable square with no common ground between areas;
the world's side grows with the code (Gaia's own is 990 m). Last, a few
sites drawn from each file's share (`CodeWorld.cells`, one per 16 m or so)
redraw the whole division as plain nearest-site cells: the rule `siteAt` in
`@gaia/terrain` reads, so a file's ground is the same for the layout,
`placeAt`, the map and the terrain. A file's patch is its cells; an entity's
lot is a cell of its directory's own ground, and its building or landmark
stands there.

A directory whose ground, with that of subdirectories that have no land of
their own, reaches 3% of the code gets its own land: a terrain region whose
cells are its files' (`RegionSpec.sites`). The terrain blends landforms and
covers by distance to those cells, so a region's cover changes exactly where
its areas end. Smaller directories are areas on their parent's land.

On each file's patch stand its finer entities, largest first, as many as its
ground allows (one per 240 m², at most six, and 420 in the world), spread
apart and clear of its first tree. Each stands as one of the understory's
own blueprints, drawn instanced with the rest of the understory at no extra
draw calls, with its file's vitality, and a person can walk up to it to
read its card: its kind, doc comment, where it is declared and its size.

**The meaning.** The engine gives structure and sizes; Jev gives meaning.
Jev judges every choice a reasonable person could make differently: the
repository's art direction, each region's land, whether that land holds
water and why (a brook where the code flows along chains of its own imports,
a still pond where much of the code leans on it, none where it stands on its
own: the option's words are the reason, stored with the choice), how that
land's trees and open ground lie (its character: a deep wood, groves and
clearings, a meadow with a few old trees, a rocky heath or a wet hollow,
again with its reason), what grows
on each file's patch, what each kind of a file's finer entities stands as,
whether each entity is a building or a landmark and which, and how much it
would walk each dependency. `planWorldRequests` builds one request per thing,
from facts and doc comments only, with options shuffled by the thing's path,
in the shape a design chooses ("What a request carries" under Jev).
`judgeWorld` asks them through any `JevClient`, eight at a time. A world
shows every dependency Jev would walk as a trail: first those that join
parts of the code no other chosen trail joins, then the most wanted; the
joining ones route first, and the terrain walks them all over one network
of shared paths (`planTrails`), which holds the composition by its ground. The repository's
own ground takes its place among the other areas rather than at the middle,
so trails between areas do not all cross it. `keptJev`
(`packages/world/src/judging.ts`) keeps Jev's answers: each request's key is
the hash of the whole request (`requestKey`), so a stored answer is used
without asking and only requests whose facts changed are asked again; an
answer that does not fit its options, or a request Jev fails, is judged by
`standInJev`, a deterministic stand-in that scores each option by the fact
tags its look suits, with a tie-break seeded by the question. The document
records who judged each thing (`judgedThing`, such as `file:src/main.ts`),
and a thing's card says so. `engineJev` in the world service is the live
client. Jev is asked only when the engine has a key and runs with
`GAIA_JEV=live`. A run whose cost (`jev.estimate`) is within the person's
spend limit goes ahead with no question; the limit is one number for every
project, kept in the app's own settings (the store's `app` project,
`settings` table, `jev-spend-limit`), and `DEFAULT_SPEND_LIMIT_USD` in
`app/world-service/open-world.ts` ($0.10) holds until the person sets one
(`setSpendLimit`; no screen sets it yet). A run that costs more asks first, with
the cost and the limit (`world.consent`); choosing the stand-in is
remembered in the project's `settings` table until the limit changes. The
world stays under the wait while Jev answers, because a judgment that
changed after the world stood would swap trees, buildings and land in view.
The land's division depends on the code alone (an entity's lot is the same
ground, 900 m², whether a building or a landmark stands on it), so
`landOf(model)` in `@gaia/world` gives every area, patch and cell before
anything is judged, equal to the finished layout's. `openWorld` sends the
renderer the areas' outlines (`world.progress` stage `land`) before it asks
Jev, then names the areas whose judgments have all settled with every
answer (stage `asking`, `settled`: an area settles once every request about
its files, its entity and itself has), and the wait paints the map from
them. `docs/connect-jev.md` is the reviewer's page for connecting it.

`placeAt(world, x, z)` in `@gaia/terrain` says where a person is: the cell
whose site is nearest the warped point names the area and the file underfoot
(`WorldPlaces`, in `@gaia/schema`); a lot's cell names its area and no file.
Past the land's rounded square (`WorldPlaces.size`) is the wild, which stands
for no directory. A world laid out as regions, as the lab's sample world is,
gives each region one cell and its files' patches are discs; `regionPlaces`
builds such a world's places. `outlinesOf(world)` traces every area's and
patch's outline from `placeAt`, once per world, for anything that draws them
(the field map draws each patch's own shape).

In the app, the lab opens on the world the world service sends. A
standalone page (`pnpm lab:html`, `pnpm lab:serve`) has no engine and opens
on Gaia's own world from `app/renderer/terrain/fixtures/gaia.json`, a
snapshot `pnpm snapshot` writes through the engine's `project.open`, judged
by the stand-in; so does the app if the world service cannot open its
folder. `?world=sample` (or `?world=small`) and
the Terrain view's "Sample world" button show the sample world instead. `standWorld` takes the
layout (`StandRequest.code`): each building and landmark on its lot, each
file's trees of the chosen species as one grove on its own cells with that
file's vitality (`growGrove` in `@gaia/terrain`: close-set at its heart,
thinning into scattered trees at its margin, inside a lobed outline seeded by
the file's path), each finer entity as an understory placement in a small
glade of its own, and the trails between lots,
walked over one network of ways (`Stand.network`: its ways of tread, the
trails walking them, its junctions and any trail dropped, with why). The area's character sets how
many trees a line of code grows, how close they stand and how large, and
whether its files' groves gather on the sides of their patches nearest the
area's heart, so they knit into one wood with open ground at the area's rim,
or keep to their patches' middles with clearings between
(`app/renderer/terrain/looks.ts`, `CHARACTERS`); a world grows at most 470
trees, and where its areas would grow more every grove gives up the same
share. The understory then grows where it belongs (`scatterComponents`):
each candidate site on a grid fixed to the world reads its kind of place from
the trees' crowns, the water and the slope, so a change in one place moves
nothing elsewhere. The ground textures take a world of any size.

## Jev

Jev answers three question types about one JSON state: `choice` (up to 255
options), `score` (2 to 10 described levels) and `noul` (the probability that
a statement is true). It cannot return text, free numbers or objects, its
answers can vary between identical calls, and it answers every question of a
request on its own, never seeing the others. Gaia therefore:

- plans a blueprint in two requests, structure and then details, so details
  agree with the structure; kinds with `stages` answer in more;
- shuffles each choice's options by the target's path, because Jev leans
  toward the first option;
- grows the context only where Jev is unsure, adding the readings Jev asks for
  (`gather` in `packages/world/src/context.ts`); a question about readings
  names the decision it would help, since Jev cannot see the other questions;
- stores every accepted answer, keyed by the hash of the whole request
  (model, facts and questions), and asks again only when the request
  changes;
- will keep a stored answer unless a fresh one wins by a margin
  (`reconcile`); the world from code does not apply that margin yet, so a
  changed request takes Jev's new answer.

### What a request carries: designs

How the world's requests are built is a `Design` (`DESIGNS` in
`packages/world/src/code-world.ts`), chosen per call of `planWorldRequests`
and `judgeWorld`, so designs can be compared on real answers before one
becomes the default. A design fixes four things:

| Design | State | Questions | Character | Escalation |
| --- | --- | --- | --- | --- |
| `first` | Summary facts | Round 12's wording | No | No |
| `revised` (the app's default) | Summary facts, the repository in words | Round 13's wording | No | No |
| `outline` | Each thing's outline | Round 13's | Yes | No |
| `escalate` | Each thing's outline | Round 13's | Yes | Yes |

- **State.** Summary facts are counts and a few docs. An outline
  (`packages/world/src/outline.ts`) is the structure a tree-sitter summary
  gives, from the engine's facts only: a file's symbols (kind, name,
  exported or not, size in words, doc comment), the files it imports and
  that import it, the tests that cover it and its health; an area's own
  files and subdirectories; an entity's files, its dependencies (with how
  many of its files import each) and its dependents. Each fits a token
  budget (`OUTLINE.tokens`: 1,200 for a file, 2,000 for an area, 1,600 for
  an entity, 2,400 for a reading), built at the richest level of detail that
  fits. Sizes are words and line numbers are left out, because a request's
  key is the hash of what it sends: with summary facts a one-line edit asks
  about 5.8 requests again (the file, every area holding it, its entity and
  the world); with outlines, 0.05.
- **Questions.** Round 13 asks an entity's building-or-landmark on its own
  and each look apart, because one choice over five buildings and five
  landmarks split a preference for buildings five ways; tells the land
  question that water is asked separately; and gives the trail question the
  fact it names (how many files import the other entity).
- **Character.** A request carries what was judged above it: an area the
  world's art direction, a file and an entity their land's landform and
  water. `judgeWorld` then asks in three waves (the world, its areas, then
  files and entities). An upstream answer that changes makes every request
  below it new, so stickiness upstream protects everything downstream.
- **Escalation.** Each request also asks one `noul` per reading
  (`more:imports`, `more:importers`, `more:tests`, `more:neighbours`,
  `more:symbols` for a file; `more:files` and `more:neighbours` for an area;
  `more:dependencies` and `more:dependents` for an entity), each naming the
  decision it would help. A request with an answer below the certainty
  threshold (0.5) is asked again (`planFollowUp`) with the readings Jev
  chose, or the first one when it chose none, asking only the unsure
  questions with their options in the same order. Both requests are keyed
  and kept like any other.

Source is not sent. A file's request in the `escalate` design also asks
`more:source`, whether reading some of its functions' and classes' code
would help, and records the answer without reading anything. The
source-reading step is an interface still to be built, once the reviewer
approves sending source: Gaia keeps each symbol's span out of the state
(`spansOf`); a third request asks one `noul` per outlined symbol ("would
reading this one change your answer?"); and a `SourceReader` in the engine
returns only the chosen spans, each capped in lines, for one more request
that asks the still-unsure questions again.

`pnpm compare-jev` (`tools/compare-jev-designs.ts`) judges a codebase under
each design and reports requests, questions, tokens and cost; how often each
design's judgments differ from `first`'s, by question; the same for one
design asked twice (Jev's own noise) and with every option reordered (its
order bias); which readings second requests chose; and re-asks per one-line
edit. `--judge stand-in` runs in process, `--judge local` runs the real
engine against the local OpenRouter stand-in, and `--judge jev` asks Jev
itself, only with `GAIA_JEV=live`, the Keychain's key and `--spend-up-to`
covering the engine's estimate. On Gaia's own repository the designs plan:

| Design | Requests | Questions | Tokens (first requests) |
| --- | --- | --- | --- |
| `first` | 267 | 584 | 362,103 |
| `revised` | 267 | 612 | 380,391 |
| `outline` | 267 | 612 | 427,476 |
| `escalate` | 267, plus a second for each unsure one | 1,593 | 608,944 |

The engine is Jev's only client (`engine/src/jev.rs`). It posts each request
to OpenRouter's Decisions API with curl, the key read from the macOS Keychain
(service `gaia-openrouter`) and handed to curl on stdin, never on a command
line or over the protocol. `jev.batch` sends many requests eight at a time
and answers each with Jev's response or the reason that request failed;
`jev.ask` sends one. Both refuse unless the engine runs with `GAIA_JEV=live`. curl retries a timeout, 429 or
5xx twice and gives up on a request after 90 seconds. `jev.status` says
whether the Keychain holds the key, asking only whether the item exists, and
whether the engine is live. Tests point the engine at a local stand-in for
OpenRouter (`tools/openrouter-stand-in.ts`) with `GAIA_JEV_ENDPOINT`, which
accepts only a loopback address; a local endpoint is sent a placeholder key
and the Keychain is never read, so the key can only go to OpenRouter.
`jev.estimate` returns what a batch would send and cost without reading the
key or touching the network: tokens are estimated at 1.8 bytes each, from
OpenRouter's published example, and priced at Jev 1.13's $0.042 per million
input tokens (output is free); `tokensOf` in `@gaia/world` counts the same
way. `pnpm print-world-requests` prints every request judging Gaia's own
world would make, with that estimate.

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
tests run against. Ruin obeys gravity: `unsupportedAt` in
`packages/realize/src/support.ts` applies the channels at a vitality and
finds every piece (the vertices that move and go together) standing on
nothing, whole or partway through collapsing, and every toppled piece not
at rest; a contract test holds every landmark and every building put
together from the structure primitives to it (buildings for their standing
pieces), so a primitive orders its thresholds by what rests on what and
collapses each piece toward what holds it.

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
- Reopening a world asks Jev only about requests it has not answered: the
  world is laid out again from the code and the kept answers. The world
  document itself is not stored yet.
- The world service will emit a `WorldChange` for every document patch, so
  notes about changes can be added later as one more listener. Nothing emits
  it yet.
