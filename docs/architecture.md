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
| Main | TypeScript (Electron) | The window and the app's lifecycle. It starts the engine and the world service, restarts the engine if it exits, and names the folder whose world each page opens: `GAIA_PROJECT`, one chosen with File > Open Folder, or none, and then the page offers the start (File > Choose a World returns to it). |
| Engine | Rust (`gaia-engine`) | Files, parsing, git, test reports, the code model, the app-data store and the Jev client with the key from the macOS Keychain. |
| World service | TypeScript (Electron utility process) | Kinds and primitives, the question planner, answer rules, vitality and the world document. It opens a codebase's world (`openWorld` in `app/world-service/open-world.ts`): the engine's `project.open`, Jev's judgments, kept in the store, and `layoutWorld`, and sends the renderer the result (`WorldDocument`) over its MessagePort. |
| Renderer | TypeScript | The UI, the Three.js scene, the realizer and the clock. In slice 1 the renderer is the lab. The lab opens into the world, full screen at eye height (`app/renderer/immersive/`), with its debugging views (Components, Terrain and Skies) behind tabs; the immersive world is the terrain lab's world without its chrome, plus three ways of telling a person where they are (a minimap of the land around them with the area's name, the field map that unfolds out of it, and markers in the world), read through `placeAt` and drawn on one field sheet (`docs/design-system.md`, "The field sheet"); touching the world only moves the person, and stopping at a thing that stands for code raises its page at the lower left; a tap on the open field map sends the person to that place, landing where `WorldHandle.landing` says, under a fold of paper that hides the move. The terrain lab bakes its world on worker threads (`app/renderer/terrain/bake-worker.ts`): a few workers compose bands of lattice rows with `composeRows`, and one finishes the bake with `finishTerrain` and stands the world's things on it with `standWorld` (`app/renderer/terrain/stand.ts`): each building's site and pad, the landmarks' sites, the network of trails leveled into the ground and which way of it each ground sample lies on, the trees and the understory, and the ground texture's data, while the others work out whose ground each part of the land is (`ownershipRows`, see Vitality), so drawing never waits on a bake. Components are still realized on the main thread; the realizer is pure and worker-safe, so it can move into workers too. |

The world service talks to the engine in newline-delimited JSON-RPC 2.0 over
the engine's stdin and stdout, relayed by the main process. Only small data
crosses: code facts, Jev requests and answers, and store records. Geometry
never crosses, because the renderer builds it. `EngineMethods` in
`packages/schema/src/engine.ts` is the TypeScript side of the protocol, and
`engine/src/rpc.rs` the Rust side. The engine answers `engine.ping`,
`project.open`, `project.locate` and `project.clone`, Jev's
`jev.estimate`, `jev.status`, `jev.ask` and `jev.batch`, and the app-data
store's `store.get`, `store.read` and `store.put`. The store (`engine/src/store.rs`) keeps one JSON file of tables
per project, `<data>/projects/<project id>/store.json`, replaced through a
rename so it is never half-written; `<data>` is the app's user-data folder,
which main passes as `GAIA_DATA_DIR`.

`project.open` walks a directory, respecting `.gitignore`, never following a
symbolic link and leaving out any file over 2 MiB, and reports each file's
facts, the entities, and the repository (`CodeModel`). Each file is
read by a careful line-based pass for TypeScript, JavaScript and Rust
(`engine/src/source.rs`), with a small lexer that keeps strings and comments
apart from code: its language and kind (source, test, config, data, docs,
script), lines, leading comment, symbols (every exported one, and the
top-level functions and classes it keeps to itself, with `exported: false`),
each with its doc comment, the line it is declared on and how many lines it
spans, imports, a rough complexity and its TODO markers. Imports resolve relative
paths, workspace packages by name through their `exports`, and Rust `mod`
declarations (not `use crate::…`, so a Rust file's own dependencies on its
siblings are not edges yet). A test covers every file it reaches through
imports, across packages (`tests.coveredBy`); `tests.own` names those of the
file's own entity; a crate's
integration tests reach its entry, and a Rust file with a `#[cfg(test)]`
module covers itself. Entities come from `package.json` and `Cargo.toml`, from
directories whose index file is no package's entry (modules), and from
directories with a `main` or `server` file (apps and services). An entity
depends on another through its manifest or when one of its files imports one
of the other's. History comes from one `git log`: per file, how many days
since its first and its last commit, its commits in the last 14 days and in
all, and how many people wrote them. Nothing runs the compiler,
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
| `@gaia/render` | Three.js materials, light and shadow, and instanced copies of a component at each level of detail | schema, realize, three |
| `@gaia/terrain` | Relief composition, the baked heightfield, water, the endless wild land past the rim, what grows on it (its covers and thickets) and the ground's height anywhere, walking, wading and swimming, a walker's gait (easing, grade, the eyes' ride over the ground and footbridge decks), the solids that stop a walk and the way around them, sight lines, where plants, the understory and landmarks stand, the routes of trails, how land divides into cells (`siteAt`), where a point is (its area and the file underfoot, `placeAt`, and every area's and patch's outline, `outlinesOf`), and whose ground it is and how alive (`groundOwners`, `ownershipOf`, `groundLook`) | schema, primitives, realize |
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
the world's side grows with the code (Gaia's own is 1,120 m). Last, a few
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
`settings` table, `jev-spend-limit`). Until the person sets one
(`setSpendLimit`; no screen sets it yet), `DEFAULT_SPEND_LIMIT_USD` in
`app/world-service/open-world.ts` is no limit at all, while Gaia is being
built, so every run goes ahead and only prints its estimate. A run that costs more asks first, with
the cost and the limit (`world.consent`); choosing the stand-in is
remembered in the project's `settings` table until the limit changes. The
world stays under the wait while Jev answers, because a judgment that
changed after the world stood would swap trees, buildings and land in view.
The land's division depends on the code alone (an entity's lot is the same
ground, 900 m², whether a building or a landmark stands on it), so
`landOf(model)` in `@gaia/world` gives every area, patch and cell before
anything is judged, equal to the finished layout's. `openWorld` sends the
renderer the areas' outlines and every file's patch (`world.progress` stage
`land`) before it asks Jev. It sends each file's health once nothing still
to be judged can change it (stage `health`, file path to vitality, exactly
as the finished world has it): a file's vitality reads one judgment,
whether it holds behavior that needs tests of its own, and only when its
request asks that and no test of its own reaches it, so every other file's
health goes out with the land and the rest as their answers come in
(`judgeWorld`'s `trace`). Every file is named once, before the document,
whether or not Jev is asked. With every answer it also names the areas
whose judgments have all settled, each with the land judged for its ground
(stage `asking`, `settled`, area path to land name: an area settles once
every request about its files, its entity and itself has, and the one that
judges its land, its own or its region's), and the areas with a question to
Jev in flight (`asking`). The wait (`app/renderer/wait/`) paints the field
map from these: each file's health as it settles (`settling.ts` works out
how much of the health at each of the land's cells is settled, and paints a
cell only once nearly all of it is), and each area's name once it settles.
Once the world is laid out, the wait gets every file's vitality, all a world
laid out in the page itself ever sends it; the terrain lab then hands it
each building's and landmark's mark at its laid-out place
(`laidOut` in `app/renderer/terrain/lab.ts`), and the stood world when the
bake returns, for its hills, water and trees.
`docs/connect-jev.md` is the reviewer's page for connecting it.

`placeAt(world, x, z)` in `@gaia/terrain` says where a person is: the cell
whose site is nearest the warped point names the area and the file underfoot
(`WorldPlaces`, in `@gaia/schema`); a lot's cell names its area and no file.
Past the land's rounded square (`WorldPlaces.size`) is the wild, which stands
for no directory. A world laid out as regions, as the lab's sample world is,
gives each region one cell and its files' patches are discs; `regionPlaces`
builds such a world's places. `outlinesOf(world)` traces every area's and
patch's outline from `placeAt`, once per world, for anything that draws them
(the field map draws each patch's own shape).

In the app, the lab opens on the world the world service sends. With no
folder named, the world service answers the page's `world.open` with
`world.start`: the worlds opened before (`RecentWorld`, kept newest first in
the app's `settings` table under `recent-worlds`, each with a `Postcard` of
its land's areas, land, water, buildings and landmarks), and the page shows
the start (`app/renderer/start/`, see `docs/design-system.md`) over the wait
until the person chooses a world they walked before, a folder (main's
dialog, through the preload's `gaiaShell.chooseFolder`) or an address on
GitHub (`world.choose`). An address goes to the engine's `project.locate`
first, which accepts only `https://github.com/OWNER/REPO` or
`github.com/OWNER/REPO` (an optional `.git`) and asks GitHub with one
`git ls-remote` whether a public repository is there, so one that leads
nowhere is answered on the start page itself (`world.start` again, with
`refused`: `address`, `missing`, `offline`, `large` or `slow`). Then
`project.clone` clones it into `<data>/clones/<owner>/<repo>` (lowercased),
or fetches into the copy already there, while the wait shows the code being
read: every commit and tree but only the checked-out files' contents
(`--filter=blob:none`), since the project's ID is its root commit and its
activity reads the whole history; no tags, no submodules, no LFS content, no
hooks or templates, symbolic links checked out as plain files, https only,
no credentials or prompts, and the user's and system's git settings
ignored; past 500 MB or 240 seconds it gives up. A clone runs on the
engine's one request loop, so other requests wait behind it. The copy then
opens like any folder, and main names the window after the world
(`world.opened`) so a reload reopens it. A
standalone page (`pnpm lab:html`, `pnpm lab:serve`) has no engine and opens
on Gaia's own world from `app/renderer/terrain/fixtures/gaia.json`, a
snapshot `pnpm snapshot` writes through the engine's `project.open`, judged
by Jev's answers kept for that snapshot in `fixtures/gaia-jev.json` (written
by `pnpm jev-world`, keyed by request hash like the app's store), with the
stand-in judging any request they no longer answer; `?judge=stand-in` shows
the stand-in's world. So does the app if the world service cannot open its
folder. `?world=sample` (or `?world=small`) and
the Terrain view's "Sample world" button show the sample world instead.
`?world=proving` (and `GAIA_PROJECT=proving` in the app) shows the proving
ground: a made-up codebase (`fixtures/proving.json`) laid out with
`layoutWorld` from choices fixed to cover every option
(`fixtures/proving-judged.json`), both written by `pnpm proving`
(`tools/proving.ts`), so it holds every building and landmark thriving, tired
and in ruin, a whole area in ruin, streams crossed on footbridges and
stepping stones, cairns, ponds, a tiny area and deep nesting
(`docs/proving-ground.md`). `tourStops` (`app/renderer/terrain/tour.ts`)
finds in any world where to stand to see each such feature. `standWorld` takes the
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
(`app/renderer/terrain/looks.ts`, `CHARACTERS`); a world grows every tree
its areas call for, at most 48 to a file's grove, since far trees cost a
card each. Only past 200,000, a world gone wrong, does every grove give up
the same share, though each keeps the one tree that names its file. The understory then grows where it belongs (`scatterComponents`):
each candidate site on a grid fixed to the world reads its kind of place from
the trees' crowns, the water and the slope, so a change in one place moves
nothing elsewhere. Each scattered placement shows the vitality of the
ground it grows on, read on the page from the ground's vitality field the
grass beneath it reads (`understoryVitality` in `stand.ts`; see Vitality),
and each file's finer entity its file's. The ground textures take a world of
any size.

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
| `revised` | Summary facts, the repository in words | Round 13's wording | No | No |
| `outline` | Each thing's outline | Round 13's | Yes | No |
| `escalate` | Each thing's outline | Round 13's | Yes | Yes |
| `shared` | Summary facts, one state per area | Round 13's | No | No |
| `shared-outline` | Outlines, one state per area | Round 13's | No | No |
| `judged` (the app's default) | Summary facts in words, areas compared | Round 15's | No | No |

- **State.** Summary facts are counts and a few docs. `judged` sends the
  same facts with every count and size in words (`fileWords`, `areaWords`,
  `entityWords`), so a one-line edit asks 0.02 requests again instead of
  4.7; a file also says what it declares (functions, classes, types and
  constants, each in words), how far tests reach it (its own entity's tests,
  only other entities', or none) and how often it changed; an area compares
  its size and its imports per file with the repository's other areas
  (`comparedWithOtherAreas`), because Jev answers each area's request alone
  and cannot see that "much of the code leans on" one area more than another. An outline
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
  fact it names (how many files import the other entity). Round 14 read
  Jev's real answers and gave every option a reason in code, because Jev
  falls back on the option that fits everything when the others describe
  only scenery: each land names the code it suits (twelve of seventeen
  areas had been the home lawn; now six lands, the root alone on the lawn),
  each trail look how many files import the other entity (37 of 39 had been
  worn footpaths), and building-or-landmark how many entities depend on it
  (`dependedOnBy` in words; twelve of fourteen had been buildings, now the
  five entities most depended on and the root are landmarks), and each
  building and landmark the kind of entity it suits (half the buildings had
  been watermills; now the engine is a stone croft, the schema a stone
  ring, the root a great willow). The vibe question says to
  judge a file by its part, size and importers, not its subject: a file
  about grass or light had been read as open meadow or a lantern willow.
  Round 15's `judged` questions ask each finer entity that may stand on a
  file's patch on its own (`form#<name>`, the first `LAYOUT.symbolsPerPatch`
  of `standingSymbols`), instead of one form for every function of a file,
  and ask every source file whether it holds behavior a test should check
  (`tests`, a `noul`), which its vitality reads (see Vitality).
- **Character.** A request carries what was judged above it: an area the
  world's art direction, a file and an entity their land's landform and
  water. `judgeWorld` then asks in three waves (the world, its areas, then
  files and entities). An upstream answer that changes makes every request
  below it new, so stickiness upstream protects everything downstream.
- **Sharing.** A design with `share: "area"` asks one request per area
  instead of one per file: the area's request carries every question about
  the files on its land, each renamed `vibe@<path>` and told which file of
  the state's `files` it is about, over one state holding the area's facts
  and each file's (`SHARE.tokens`, 12,000, splits a large area into
  several). `WorldRequest.carries` names the things a shared request judges,
  `unshare` hands each its own answers, and `thingsOf` lists them for the
  store's who-judged-what. Jev answers each question of a request on its
  own: asked alone, with 13 others or in reverse order, a question's
  probabilities moved no more than asking it twice (0.07 at most).
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

On 2026-10-08 Jev answered `revised` and `judged` twice and once reordered
over a fresh snapshot (292 files; $0.12 for 1,932 requests). `judged` cost
$0.024 a world against $0.016. Per symbol, forms used all ten options
instead of eight (spread 0.63 to 0.71 of the most possible), with median
certainty 0.41 to 0.50 and half the noise (10% to 6% of answers changed when
asked again); vibes kept their spread at median certainty 0.83 to 0.91. With
areas compared, lands spread 0.65 to 0.77 and water 0.45 to 0.62, but
character collapsed toward the deep wood (0.53 to 0.39). Jev judged 147 of
176 source files to need tests, and the 29 that do not are types, kinds,
styles, markup and barrel files.

`pnpm compare-jev` (`tools/compare-jev-designs.ts`) judges a codebase under
each design and reports requests, questions, the tokens OpenRouter billed,
cost and latency; how often each design's judgments differ from the first
design's, by question; the same for one design asked twice (Jev's own noise)
and with every option reordered (its order bias); which readings second
requests chose; and the requests and tokens a one-line edit asks again. `--judge stand-in` runs in process, `--judge local` runs the real
engine against the local OpenRouter stand-in, and `--judge jev` asks Jev
itself, only with `GAIA_JEV=live`, the Keychain's key and `--spend-up-to`
covering the engine's estimate. On Gaia's own repository (the snapshot of
292 files) the designs plan:

| Design | Requests | Questions | Tokens (first requests) |
| --- | --- | --- | --- |
| `first` | 322 | 697 | 448,014 |
| `revised` | 322 | 740 | 505,609 |
| `outline` | 322 | 740 | 553,477 |
| `escalate` | 322, plus a second for each unsure one | 1,920 | 772,057 |
| `shared` | 70 | 740 | 580,994 |
| `shared-outline` | 72 | 740 | 641,476 |
| `judged` | 322 | 1,332 | 846,618 |

On 2026-10-08 Jev answered every design twice and once reordered over the
earlier snapshot of 235 files
(`compare-jev --judge jev`, $0.31 for 4,018 requests; the round-13 wording
of lands, trails and building-or-landmark). Billed tokens run about 78% of
the estimate.

| Design | Requests sent | Billed tokens | Cost | Median ms | Judgments that differ from `revised` | Asked twice | A one-line edit asks again |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `first` | 267 | 290,947 | $0.012 | 269 | 26% | 4.5% | 5.8 requests, 8,865 tokens |
| `revised` | 267 | 302,770 | $0.013 | 245 | the baseline | 5.8% | 4.8 requests, 10,492 tokens |
| `outline` | 267 | 366,863 | $0.015 | 470 | 28% | 4.7% | 0.05 requests, 121 tokens |
| `escalate` | 415 | 899,217 | $0.038 | 286 | 28% (14% from `outline`) | 6.5% | 0.05 requests, 138 tokens |
| `shared` | 59 | 277,844 | $0.012 | 379 | 23% | 5.0% | 11.2 requests, 106,721 tokens |
| `shared-outline` | 63 | 335,020 | $0.014 | 335 | 32% | 4.5% | 0.08 requests, 573 tokens |

Reordering every option moved 2 to 6% of file judgments, no more than
asking twice: with options shuffled per thing, Jev shows no lean toward the
first. Sharing an area's state saves four requests in five and 8% of
tokens but changes a quarter of the judgments, mostly for the worse: each
question reads the whole state, so a file's neighbours sway it (substantial
files of logic turn to open meadow, hubs lose their willows). Sharing pays
only for questions about one thing.
The engine is Jev's only client (`engine/src/jev.rs`). It posts each request
to OpenRouter's Decisions API with curl, the key read from the macOS Keychain
(service `gaia-openrouter`) and handed to curl on stdin, never on a command
line or over the protocol. `jev.batch` sends many requests eight at a time
and answers each with Jev's response or the reason that request failed;
`jev.ask` sends one; each response carries the cost and input tokens
OpenRouter billed (`costUsd`, `inputTokens`) and its time. Both refuse unless the engine runs with `GAIA_JEV=live`. curl retries a timeout, 429 or
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
unused code, debt markers, and named Jev judgments. A file is untested in
full when no test reaches it and in half when only other entities' tests do,
and that penalty is scaled by Jev's probability that the file holds behavior
a test should check (`FileJudged.needsTests`, asked by the `judged` design),
so a file of types or styles loses nothing for having no tests of its own. An entity's signals read
the same facts as shares of the whole (`entityVitalityOf`), so one failing
test in a large package costs less than half its tests failing. Each term
carries a reading in words, such as "2 of 4 test files failing", for the
card that tells a person what a thing is. Activity, from recent commits, is
a separate channel that never lowers vitality.

A directory's vitality pools its files' (`areaVitality` in `@gaia/world`):
every file under it, its subdirectories' included, weighted by its size,
so the whole reads as the share of it that thrives; the field map, the
minimap and the markers weigh each file by the ground its patch holds,
which the layout gives in proportion to its code. The field map spreads
each file's own vitality over the ground around it (`healthField`), so its
colors run in one gradient across areas; an area's own ground, the files
directly in it or everything under it where it holds none of its own
(`groundVitality`), sets the health it settles on far from any file and
its dry-brush streaks; `""` is the whole world's.

The land shows vitality as the trees do (`docs/design-system.md`, "Vitality
on the land"). Every point of a world from code is someone's ground: a
file's patch, an area's own ground (an entity's lot), or past the land the
wild's, which always thrives. While the bake finishes, the other bake
threads work out, for each sample of a 4 m grid over the land, the few
owners whose ground it is and their shares in 255ths (`ownershipRows` and
`groundOwners` in `@gaia/terrain`; `groundSites` in
`app/renderer/terrain/stand.ts` numbers the owners): the owner of the cell
holding the sample and, near a border, its neighbors', each share falling
off by e for every 3 m its nearest site lies farther from the warped point,
so health eases across borders. The page weighs each owner's vitality by its
share (`vitalityOver`, with `ownerVitality` in `stand.ts`) into a small
texture whose red channel is the ground's own vitality (its file's, or on a
lot its area's pooled `areaVitality`) and whose green is that of the area
the ground lies in; the grass and the ground read the red and the water the
green, and `groundLook` is the rule they follow. The scattered understory
reads the red on the page's thread, through `vitalityAt`, the CPU twin of
the texture's filtering. A change in vitality
rewrites the texture's bytes (about 3 to 9 ms on the page's thread for
Gaia's world) and never rebakes: the lab's
`__lab.terrain.fileVitality(path, v)` sets a file's vitality, or every
file's under a directory, on its trees, its finer entities, its ground and
what grows there, and its area's lots and water, and `__lab.terrain.groundVitality(x, z)` reads the texture as the
shaders do.

What a thing's page says is one typed value, `PageContent` in
`app/renderer/immersive/sketch.ts`: up to two notes, each tied to a part of
the thing's sketch, and the rest, a list of entries each a fact beside its
label or a line of prose. One function, `describe`, makes it; today it
fills the notes with `symptomsOf`, which turns the vitality's signals into
a few words about what is specific to this thing and says nothing of a
signal nearly every file shares, and the rest with the doc comment's first
sentence and the facts the code knows. The Engine and Jev session owns
what goes in it and may change the type; the page shows whatever it holds
within its limits (`docs/design-system.md`, "What a thing says").

Every primitive writes five per-vertex vitality channels: `loss` (the vitality
below which a piece collapses to its pivot, or a spray's leaves drop in
place), `droop` (how far its bough sags about the bough's joint), `wither`,
`glow` and `pivot` (the point the piece hangs from), and what carries the
vertex: `bough` (the joint where its bough or stem leaves the trunk or the
ground) and `twig` (where its twig leaves the bough), which wind and droop
bend it about, plus a `tint` hue offset, a `cutout` that places a vertex on a
leaf card or marks a fir frond's solid heart (`CUT.core`), and `close`, how far a piece folds toward its pivot at night (a
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
and hue read per instance and its shape varied a little by where it stands. Far enough away that its crown spans few pixels, a tree draws as one card baked from its own build by its own shaders (`bakeFarForm` and `createFarCards` in `packages/render/src/far.ts`): healthy and withered color, normal, depth, glow, foliage and coverage at four vitalities per texel, from 96 directions, lit live with the scene's light; the woods choose which copies draw far. `startFarBake` bakes a form a few views a frame so a loading screen keeps painting, and `farFormData` and `farFormFrom` store a baked form and read it back, so each build bakes once per install (`FAR_BAKE_VERSION` marks what a bake writes).
`applyVitality` in `packages/realize/src/channels.ts` is the CPU reference the
tests run against: a piece collapses in the plant's rest shape, the wind
bends it (`swayAt` in `packages/realize/src/sway.ts`, the twin of
`SWAY_GLSL` in `@gaia/render`, on the gusts of `gustAt` in
`packages/realize/src/wind-field.ts`), and droop bends its bough last. Ruin obeys gravity: `unsupportedAt` in
`packages/realize/src/support.ts` applies the channels at a vitality and
finds every piece (the vertices that move and go together) standing on
nothing, whole or partway through collapsing, and every toppled piece not
at rest; a contract test holds every landmark and every building put
together from the structure primitives to it (buildings for their standing
pieces), so a primitive orders its thresholds by what rests on what and
collapses each piece toward what holds it. Plants keep the same rule, in
still air and in a strong gust: every flora primitive's crown, on frames of
every kind with bark and blossoms, and every great tree, at vitality 1, 0.5
and 0.15.

## Detail

Every part also carries `piece`: the connected run of triangles each vertex
belongs to (one leaf card, one limb, one petal) and that piece's size.
`PartBuilder` writes it, so every primitive has it without work of its own.
Distance thins detail by whole pieces, from the person's eye in every pass:
`pieceReach` and `detailAt` in `packages/realize/src/detail.ts` are the rule
and the CPU reference, and the plant shader applies the same numbers. A
coarser level of detail is the full build with the pieces that have left by
its distance taken out, every kept vertex bit-identical, so detail is computed
from one build and never shifts a primitive's random streams. A fir frond's
heart (`CUT.core`) also leaves near the eye, shrinking to its center by its
own size (`CORE_NEAR` in `packages/render/src/plant.ts`), in the view only:
its shadow stays, so the shade under a fir never changes as a person walks.

`createPlantInstances` in `@gaia/render` draws many copies of one plant, one
instanced mesh per part and level, and `draw` packs the copies it is given
into each level's instance buffer. Which copies draw, and at which level, is
the terrain lab's (`createCopies` in `app/renderer/terrain/woods.ts`): it sorts
copies into 32 m cells, and before each pass (the sun's shadow, the water's
mirror, the view) the scene's `onBeforeRender` calls `cull` with that pass's
camera, which draws only the cells the camera sees. A cell draws a coarser
level only when its nearest point is past that level's distance, where every
piece the level leaves out has already left on screen, so the two draw the
same pixels.

The woods also measure every tree's crown in each pass's own device pixels.
A crown under `FAR.swapPx` (128, or 64 on a touch-first screen, whose
far forms bake at that size) draws as its far form, one card baked from
its build (`packages/render/src/far.ts`). Between 128 and 160 pixels, the band
(`farness` in `woods.ts`), the card draws over the full tree as far into its
form as the crown is into the band, so a tree never changes form in one
frame. When the full trees a view draws pass the frame budget (`BUDGET`,
1.5 million triangles), the view's swap size rises 2% a second, up to 1.5
times the size the forms baked at, and eases back once the view is light
(`createFrameBudget`): each half second a tree in the band moves across it
no more than the swap test's middle step. Each pass gathers its far copies into one batch, and the far cards
draw it in one call per form. Nothing past `AIR.dissolveEnd`, where the air
has dissolved everything into the sky, draws at all. Every tree build bakes
into its far form a few views a frame under the wait (`startFarBake`), and
the wait lifts only once all of them are ready. A baked form is kept in the
browser's IndexedDB (`app/renderer/terrain/far-store.ts`), keyed by a hash of
the build, the bake's version and the swap size, so each build bakes once.
A new world settles in over a few frames (`adopt`), and every shader it
needs compiles off the page's thread (`warmSoon`, three's `compileAsync`)
for the view, the mirror's and the shadow's targets and the shadow's depth,
while the world draws no frames, so the wait never stutters as a world
opens.

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
