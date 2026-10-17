# Architecture

Gaia passes plain typed data through four stages: the code graph, the world
document, the realized world, and the screen. Jev writes only into the world
document, and only by answering questions Gaia derives from declared types.
The realizer turns the document into geometry as a pure function, so a part of
the document that did not change renders exactly as it did before.

## Data

| Data | Contents | Made by | Status |
| --- | --- | --- | --- |
| Code facts | Per-path facts the world is laid out from: language, size, definitions and imports both ways; and entities, with their size, surface and dependencies | `factsOf` in `@gaia/world`, from the code graph alone | Derived from the graph whenever a world opens |
| Code graph | A node for every directory, file, definition and block, the edges between them, each one's lines and history and Jev's judgments, and each directory's entity | The Rust engine, with Jev | Read for every definition's stand, importance and quality; the world moves onto it alone next |
| Vitality | A value from 0 to 1 per path and per entity | Jev's quality from the understanding pass | Recomputed live |
| World document | Regions, blueprints, instances, links and the world's art direction, as typed JSON | The world service, from Jev answers and layout, plus the person's edits | The world's source of truth, stored per project |
| Realized world | Meshes, terrain and material parameters | The realizer | A cache keyed by content hash |

## Processes

| Process | Language | Owns |
| --- | --- | --- |
| Main | TypeScript (Electron) | The window and the app's lifecycle. It starts the engine and the world service, restarts the engine if it exits, and names the folder whose world each page opens: `GAIA_PROJECT`, one chosen with File > Open Folder, or none, and then the page offers the start (File > Choose a World returns to it). |
| Engine | Rust (`gaia-engine`) | Files, parsing, git, the code graph, the app-data store and the Jev client with the key from the macOS Keychain. |
| World service | TypeScript (Electron utility process) | Kinds and primitives, the question planner, vitality and the world document. It opens a codebase's world (`openWorld` in `app/world-service/open-world.ts`): the engine's `project.graph`, the facts `factsOf` derives from it, Jev's judgments, kept in the store, and `layoutWorld`, and sends the renderer the result (`WorldDocument`) over its MessagePort. While the world stands it watches the folder for a new commit and heals the world with it (`healWorld`, `world.vitality`). |
| Renderer | TypeScript | The UI, the Three.js scene, the realizer and the clock. The page shows only the world, full screen at eye height (`app/renderer/immersive/`): the world (`createWorld` in `app/renderer/terrain/world.ts`), plus three ways of telling a person where they are (a minimap of the land around them with the area's name, the field map that unfolds out of it, and markers in the world), read through `placeAt` and drawn on one field sheet (`docs/design-system.md`, "The field sheet"); touching the world only moves the person, and stopping at a thing that stands for code raises its page at the lower left; a tap on the open field map sends the person to that place, landing where `WorldHandle.landing` says: along the trails, or straight across the land where they wander (`WorldHandle.travel`, with `trailWay`, `acrossWay`, `planTrip` and `travelStep` in `@gaia/terrain`), each mark of the way ahead asked of the standers before the person comes near it, or where neither goes, under a fold of paper that hides the move. Scripted checks drive the world through the hooks of `window.__lab.terrain` (`app/renderer/terrain/hooks.ts`), which reach inside it through `WorldInside`; nothing a person does goes through them. The world bakes on worker threads (`app/renderer/terrain/bake-worker.ts`): a few workers compose bands of lattice rows with `composeRows`, and one finishes the bake with `finishTerrain`, which scales the relief into the budget by a fit found on a survey of every 4th sample and checked once at every sample, and stands the world's things on it. On the page the land is a clipmap (`createPageLand` in `app/renderer/terrain/land.ts`): seven levels of 512 by 512 samples centered near the person, level k every 2^k-th sample on the world's own grid, where ground ring k sets its vertices, so the rings read exactly the samples they did. The page never holds the whole world's land: its land workers bake each level's window in 64-sample chunks from the world's plan alone (`app/renderer/terrain/land-chunks.ts`), taking jobs from one queue on the page soonest wanted first: the person's land, then a painting's set-aside land, and a level moves once the person has walked a chunk from its middle and every chunk of its new window has come, so a window never shows half old and half new. Every texture that holds a value per lattice sample takes its data from the levels: the ground's height, water and distances, each sample's covers, and which ways each sample lies on (`createGroundTexture` in `ground.ts`), so the land's memory on the page and the GPU is the same at any world size. A coarse level names a way as far out as a reader of its cells asks (`placeReach`), so a far trail stays as worn as a near one, and a reader between samples takes the finest level that holds the point and blends into the next near its window's edge (`clipLevel`). The clearings' mask, which only the grass reads, is one window 256 m across around the grass, drawn again from the outlines and capsules as the grass moves on (`app/renderer/terrain/clearings.ts`). Level 0, the land within a few hundred meters to the meter, is the page's `Terrain`; a read past it falls to the finest level that holds the point (`Lattice.beyond`), and a jump waits under its fold of paper until the land around its landing has come. The land a tile at a time: `planTerrain` makes the world's whole-world decisions once, the fit from the survey and the water from the ground along its beds alone, each bed solved on a window of just the ground it reads with the beds before it cut in again, so the plan never holds a lattice the size of the world (the whole world's bake solves its water on the same windows, so the two agree to the bit); `bakeTile` bakes any tile from the plan with a margin for its shore, or every stride-th sample of it for a coarser level; and `standTile` levels it under the buildings' pads, the landmarks' footings and the trails' treads as standing the world recorded them (`LandEdits`), byte for byte as the stood world holds it (`app/renderer/terrain/stand.test.ts`). The finishing worker stands the world's things with `standWorld` (`app/renderer/terrain/stand.ts`): each building's site and pad, the landmarks' sites, the network of trails leveled into the ground, the trees, and the stones, bushes and flowers that stand for code, while the others work out whose ground each part of the land is (`ownershipRows`, see Vitality), so drawing never waits on a bake. It hands the page the world's plan and what standing did to the land (`LandSource`); the whole world's land stays on the worker. The components every world opens with (the trees, landmarks and bushes) and a codebase's buildings are realized on worker threads too (`app/renderer/terrain/made.ts`), made ahead while the wait draws: the page takes each build as it is made, and realizes in place any build it asks for that was not made ahead, the same either way since the realizer is pure. Each build is held only until its meshes are made and its far form baked; one asked for after that, such as by the swap test, is realized again. A plant's meshes keep no copy of their buffers on the page once the GPU holds them (`letGoOnUpload`), but for the positions, normals and index of what a ray picks: a building or a landmark. |

The world service talks to the engine in newline-delimited JSON-RPC 2.0 over
the engine's stdin and stdout, relayed by the main process. Only small data
crosses: code facts, Jev requests and answers, and store records. Geometry
never crosses, because the renderer builds it. `EngineMethods` in
`packages/schema/src/engine.ts` is the TypeScript side of the protocol, and
`engine/src/rpc.rs` the Rust side. The engine answers `engine.ping`,
`project.graph`, `project.source`, `project.commit`, `project.commits`, `project.locate` and `project.clone`, Jev's
`jev.estimate`, `jev.status` and `jev.batch`, and the app-data
store's `store.get`, `store.read` and `store.put`. The store (`engine/src/store.rs`) keeps one JSON file of tables
(`StoreTable`) per project, `<data>/projects/<project id>/store.json`, replaced through a
rename so it is never half-written; `<data>` is the app's user-data folder,
which main passes as `GAIA_DATA_DIR`.

A world is read from a snapshot of the project's files
(`engine/src/graph/walk.rs`, `Snapshot`). In a git folder with a commit, that
is the tree of the commit checked out, listed with `git ls-tree` and read in
one `git cat-file --batch`. Untracked and ignored files and uncommitted edits
are never part of the world, and a submodule is only a pointer, so saving a
file changes nothing until it is committed. Outside git, in a repository with
no commits yet, or in a folder nothing of which is committed, it is the disk,
respecting `.gitignore` and skipping any folder that is a git checkout of its
own. Either way it never follows a symbolic link and leaves out any file over
2 MiB. The graph records the commit it read (`CodeGraph.commit`), the world
document carries it, and the journal's code comes from that same commit
(`project.source`), so its lines always match the graph's even after a new
commit. `project.commit` says which commit a world of a folder would be read
from now, without reading it, or none when it would be read from disk.
`project.commits` counts the commits since one commit up to another that
touched a file under the folder, or says none when the first is no longer
in the second's history, as after a rebase.

## Packages

| Package | Contents | Imports |
| --- | --- | --- |
| `@gaia/schema` | The type builder, ports and vitality channels, primitive and kind contracts, code facts, blueprints and the world's places, Jev's wire format, the engine protocol, content identity | Nothing |
| `@gaia/primitives` | Primitive declarations and geometry, palettes, the manifest `PRIMITIVES` | schema |
| `@gaia/kinds` | The flora, structure, rock, wildflowers, landmark, link, biome and world kinds | schema |
| `@gaia/world` | The question planner, file and entity vitality, and the world laid out from code: the code graph, the requests Jev answers about it, the division of the land and the layout | schema, terrain (the land's division rule) |
| `@gaia/realize` | Blueprint to parts, world and region looks at an hour, the light between a day's keys, the sky and air references, the trees', bushes', stones' and flowers' presets that Jev's forms name, channel math, detail by distance | schema, primitives |
| `@gaia/render` | Three.js materials, light and shadow, and instanced copies of a component at each level of detail | schema, realize, three |
| `@gaia/terrain` | Relief composition, the baked heightfield, water, the endless wild land past the rim, what grows on it (its covers and thickets) and the ground's height anywhere, walking, wading and swimming, a walker's gait (easing, grade, the eyes' ride over the ground and footbridge decks), the solids that stop a walk and the way around them, sight lines, where plants and landmarks stand, the routes of trails, how land divides into cells (`siteAt`), where a point is (its area and the file underfoot, `placeAt`, and every area's and patch's outline, `outlinesOf`), and whose ground it is and how alive (`groundOwners`, `ownershipOf`, `groundLook`) | schema, primitives, realize |
| `@gaia/app` | Electron main, preload, world service, and the renderer (the page and its world) | Every package |

ESLint enforces these boundaries and the purity rules; `eslint.config.js`
gives the reason next to each rule.

## The schema

A **primitive** is a pure procedural function with typed parameters and a
role, such as `branching@1` (Skeleton) or `leaf-clumps@1` (Foliage). It is code,
versioned in its ID. A **kind** declares slots by role and the subject it
stands for: a file (`flora`, `rock`, `wildflowers`), any thing that stands
for code, an entity, a file or a definition (`structure`, `landmark`, which
read its numbers from `ThingFacts`), a region (`biome`), a dependency between
two entities (`link`) or the repository (`world`). A `link`'s blueprint fills only a trail's look; the
terrain finds its route. A `structure`'s footprint lays out one
`BuildingPlan`: the masses the building is joined from (each a block or a
round turret with its own storeys and roof form: gable, hip, half-hip,
lean-to or cone), its floor, and where every door and window goes. Its body,
roof, openings, ornaments and optional feature (a `waterwheel@1` or a
`tower@1` against the house, or a `dovecote@1`, `well@1`, `bell@1`,
`forge@1` or `granary@1` in its yard) each build on that plan, so walls
rise to the roofline over them and everything agrees by construction. The
geometry lives in `packages/primitives/src/geometry/building/`, one file per
part: layout, frame (reading the plan), walls, roofs, openings, garden,
ruin, features and yard.

An **entity** is a named unit of the code with a boundary, a public surface,
things that depend on it and a health of its own: a package or crate, as
its manifest (`package.json`, `Cargo.toml`) declares it. Only a manifest
makes one; no file's name or path decides that a directory is an entity.
`EntityFacts` in `packages/schema/src/facts.ts` is what the engine will
report for each: its root path (its identity), name, form, manifest, entry,
doc, size, exports, the entities it depends on and that depend on it, and
its files' tests, diagnostics and git activity summed. Entities nest; each
file belongs to its innermost one. Anything can stand as anything, by its
importance ([decision 64](decisions/64-anything-can-stand-as-anything.md)):
every entity, file and definition stands as one thing, flowers, a stone, a
bush, a tree, a building or a landmark, whichever Jev chooses among the
forms its importance is offered; trails stand for dependencies between
entities. The kinds bind only numbers from the facts (a building's size from
lines, storeys from exports and a feature's reach from dependents, which are
the entities that import an entity, the files that import a file or the
definitions that call or name a definition; a landmark's scale from its
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

A primitive may say what its place must have for it to stand there
(`needs`), as a waterwheel needs running water. The planner offers a slot
only the primitives whose needs the thing's place meets (`has` on the
target), and Jev chooses among those as it would; nothing overrides its
pick. A building's place has what its region's water holds: a water look
says so (`holds`), and a brook or a trickle holds running water. Composing
runs before the land is laid out, so the place is the region, not the lot.
The land keeps that promise: every region given a brook or a trickle has its
river (`routeRivers`), and a building whose feature needs running water is
stood on that river's bank when the world is stood (`findBankSite`), never
on dry ground; a building that finds no bank is named in the stand's `dry`,
which the tests require to be empty.
A need may also be a range of a thing's rank by importance among the
world's own entities, files and definitions (`{ rank: [min, max] }`), from 0
for the least important to 1 for the most; `meets` in `@gaia/schema` is the
one rule for both, and a form's look declares its needs as a primitive does.

## A world from code

`@gaia/world` turns the engine's code graph into a world document
(`CodeWorld`, in `packages/world/src/code-world.ts`) in three steps: graph to
facts, facts to land, and Jev's meaning on top.

**The facts.** `factsOf` (`packages/world/src/facts.ts`)
derives from the graph alone the facts the world is laid out from: each
file's size, language, definitions (every one it exports, and the functions
and classes at its top level) and imports both ways, and each entity a
directory holds, with its files, size, the surface its entry gathers and the
entities its files import from. Only the code's structure is here, the facts
the new engine reads too: tool signals, test coverage, history, file kinds
and doc comments are not facts the world reads.

**The land.** `layoutWorld` lays the graph out as land with `divideLand`
(`packages/world/src/land.ts`). Each directory's land is divided among its own
ground (its files and its entity's lot, kept together at its heart) and its
subdirectories, each in proportion to its code (10 m² a line, and 50 m² for
each definition standing on it, so a wood stands close enough to read as one
from inside it); then each of those is divided the same way,
down to the files. Every division is a
relaxed, weighted nearest-site division of a raster of the land, starting
from spots seeded by each child's path, so the same code gives the same land
and a small change moves it a little. A child the relaxing leaves short of a
cell for each of its leaves takes them from siblings with cells to spare,
starting from the far edge of the one with the most, so every file and every
definition holds ground of its own however crowded its parent. The divisions are measured from points
moved by the land's warp (`warpPoint`, a broad sway and a fine one), so
borders curve and wander like fields' and nothing is a circle or a square.
The land fills the walkable square with no common ground between areas;
the world's side grows with the code (Gaia's own is 1,120 m). Last, a few
sites drawn from each file's share (`CodeWorld.cells`, one per 16 m or so)
redraw the whole division as plain nearest-site cells: the rule `siteAt` in
`@gaia/terrain` reads, so a file's ground is the same for the layout,
`placeAt`, the map and the terrain. A file's patch is its cells; an entity's
lot is a cell of its directory's own ground, and what it stands as stands
there; a file stands at its patch's heart, its own ground's plot.

A directory whose ground, with that of subdirectories that have no land of
their own, reaches 3% of the code gets its own land: a terrain region whose
cells are its files' (`RegionSpec.sites`). The terrain blends landforms and
covers by distance to those cells, so a region's cover changes exactly where
its areas end. Smaller directories are areas on their parent's land.

On each file's patch every definition stands, nested ones included: each
function, method, class and type, never a plain value, a stylesheet rule, a
document's section or a data file's key (`definitionsOf` in
`packages/world/src/definitions.ts`). The patch is divided the way the land
is (`dividePlots`): the file's own ground at its heart, and a plot for each
definition as large as its own lines plus 50 m², all on the 30% of the patch
nearest its middle (`LAYOUT.cluster`), so a file's definitions gather into a
copse with open ground round it and woods and meadows alternate;
a definition's plot is divided again among the definitions inside it, and
each stands at its plot's middle. A patch with fewer raster cells than plots
is divided on a finer raster, so no two definitions share a spot. With Engine's graph (`project.graph`,
judged) the definitions are the graph's, and each carries Jev's importance
from the understanding pass, 0 to 1, which sets its size; without one, the
facts' top-level symbols stand, sized by their length. Each stands as
the form Jev chose for it: a tree, drawn with the woods, or one of the
understory's own blueprints, drawn instanced with the rest of the
understory; neither costs draw calls of its own. A definition Jev raises to
a building or a landmark stands on its own plot as one of the world's
things (`CodeThing.of`), composed part by part as an entity's is; and each
file and entity standing as a plant, a stone or flowers is one of
`CodeWorld.standing`, at its patch's heart or on its lot. None of this
changes the land: a raised thing takes the ground its code already holds,
and the definitions around it keep off it as they keep off each other. Each
has its own vitality, and a person can tap it to read its page in the
journal.

**The meaning.** The engine gives structure and sizes; Jev gives meaning.
Jev judges every choice a reasonable person could make differently: whether
each region's land holds water and why (a brook where the code flows along chains of its own imports,
a still pond where much of the code leans on it, none where it stands on its
own: the option's words are the reason, stored with the choice), what each
entity, file and definition stands as, and how much it would walk each
dependency. What a thing stands as is asked once the understanding pass has
judged how much each matters (`planStanding`): each thing's rank by
importance (`rankThings`, ties sharing the middle; an entity among the
world's entities, placed from 0.85 up, since its importance is judged
against its folder's neighbors and a package is a place of its own, and a
file or a definition among the files and definitions)
offers it every form whose range holds it (`formsFor`, the ranges in
`SIZES` in `app/renderer/terrain/looks.ts`, overlapping, smallest
first: flowers, stones, bushes, trees, buildings, landmarks), and Jev picks
among them by each form's character; a thing offered one form alone stands
as it unasked. The request carries each thing's importance and no line
counts, so a form's size follows how much the thing matters. A file's own question goes in the first of its definitions'
requests, 24 to a request, each with the file's and each definition's
importance, and an entity is asked in a request of its own. Jev never names a
preset: `composeWorld` asks these first and then composes the world part by
part through the planner (`composeThings` in
`packages/world/src/compose.ts`): its sky (the world kind's light, sky and
wind, the light asked first), each region's land (the biome kind's relief, ground cover,
air, accents and natives), the building or landmark of every thing Jev
raised to one, entity, file or definition, and each trail Jev would walk (the link kind's route:
its width, wear, edging, winding and crossing). A building or landmark waits
for its land: its palette family is asked among the land's native families
(`DetailOptions.narrow`), filled in unasked when the land names one, and
asked among all nine when it names none. A land's stream or pond is its
area's water, asked once: the water's look settles a valley's
`relief.stream` and a basin's `relief.pond` (`Look.settles`), which are
filled in, never asked (`DetailOptions.fixed`). Each is composed its
structure first and then each stage's details, one request a wave, each part
asked in its own instruction from its kind's slot (`Slot.ask`). Each
composing request carries what the new engine established about its part of
the code: the repository for the sky (`repositoryState`), the directory and
the water Jev judged its land holds for a land (`areaState`), the entity's
form, exports and dependencies as `factsOf` reads them from the graph for
a building or landmark (`composingState`), a file's own measures and judged
values (`fileState`), a definition's role, signature, doc and judged values
(`definitionState`), and for a trail the two entities
and how many of the first's files import the second's (`trailState`); each
with its importance and quality concepts from the understanding pass and its
files, lines, languages, folders, history and most important definitions
from the graph. The blueprints it makes are the world's (`Judgments.sky`,
`Judgments.lands`, `CodeThing.blueprint`, `CodeTrail.route`), and the renderer
realizes each from its own: the sky with `realizeSky`, each region's land
with its water (`withWater`, which turns a landform that cannot hold the
water into the valley or basin that can), each thing, and each trail's route, which the
stand walks as it was composed (`StandCode.trails`). The world's composing
vocabulary is `Looks.compose` (`COMPOSING` in
`app/renderer/terrain/looks.ts`). A world without a composed sky, a land
for each region or a route for each trail fails to open: nothing stands in
for an answer Jev did not give. The proving ground, written by hand, names
its own sky, lands, things and trails (`tools/proving-looks.ts`), and its
generator writes their blueprints into its fixture. `planWorldRequests` builds one request
per thing, from facts and doc comments only, with options shuffled by the
thing's path, in the shape a design chooses ("What a request carries" under
Jev); under the `judged` design it asks only each region's land and each
entity's trails, and `planStanding` asks what each thing stands as, given
Engine's graph about the definitions the layout will stand, so each answer
meets its definition.
`judgeWorld` asks them through any `JevClient`, eight at a time, and the
opening as many at once as the engine sends Jev; what each thing stands as
and composing follow the understanding pass, and the opening's count of
answers keeps moving through them. A world
shows every dependency Jev would walk as a trail: first those that join
parts of the code no other chosen trail joins, then the most wanted; the
joining ones route first, and the terrain walks them all over one network
of shared paths (`planTrails`), which holds the composition by its ground. The repository's
own ground takes its place among the other areas rather than at the middle,
so trails between areas do not all cross it. `keptJev`
(`packages/world/src/judging.ts`) keeps Jev's answers: each request's key is
the hash of the whole request (`requestKey`), so a stored answer is used
without asking and only requests whose facts changed are asked again. A
request Jev cannot answer, once the engine's client has retried it (a
timeout, a 429 or a 5xx, twice), or an answer outside its options, rejects
with `RequestFailed`, naming the request (`requestSubject`) and why, and the
opening fails with it (`world.failed`); so does an understanding slice with a
failed request (`UnderstandProgress.failures`). Nothing guesses an answer in
a request's place: a world is always Jev's. Jev is asked only when the engine
has a key and runs with `GAIA_JEV=live`; without one, a world that needs an
answer fails and says how to turn Jev on, and one whose every answer is kept
opens from the store. `engineJev` in the world service is the live client. A run's cost is judging's (`jev.estimate`) and
the understanding pass's (`understanding.plan`, below) together. Planning
the pass takes seconds and only says what it will cost, so it is planned
only when there is a limit to weigh it against, or when Jev cannot be asked
and the opening must know whether anything is left to ask; with no limit the
pass runs as it goes. A run within the person's spend limit goes ahead with no question; the limit is one number for every
project, kept in the app's own settings (the store's `app` project,
`settings` table, `jev-spend-limit`). Until the person sets one
(`setSpendLimit`; no screen sets it yet), `DEFAULT_SPEND_LIMIT_USD` in
`app/world-service/open-world.ts` is no limit at all, while Gaia is being
built, so every run goes ahead and only prints its estimate. A run that costs more asks first, with
the cost and the limit (`world.consent`); declining leaves the world
unopened (`world.failed`), and the next opening asks again. The
world stays under the wait while Jev answers, because a judgment that
changed after the world stood would swap trees, buildings and land in view.
The land's division depends on the code alone (an entity's lot is the same
ground, 600 m², whether a building or a landmark stands on it, and a file's
plots follow its definitions' lines, never what Jev judged), so
`landOf(model, graph)` in `@gaia/world`, given the engine's graph trimmed by
`judgedGraph`, gives every area, patch, cell and lot before anything is
judged, equal to the finished layout's: a lot (`LotPlace`) is
the middle of the ground kept for an entity, which its building or landmark
stands within `LAYOUT.lotReach` of, whichever Jev makes it. `openWorld`
sends the renderer the areas' outlines, every file's patch and every lot
(`world.progress` stage `land`) as soon as the graph exists, before it
plans or asks Jev anything. It sends each file's health once nothing more
will be asked about it (stage `health`, file path to vitality, exactly as
the finished world has it): a file's vitality is its quality, which
`understanding.next` reports for each file a slice settled for good, so
files wash in as the pass goes. After each slice it also sends what the
slice read (stage `understood`: the files and areas whose requests in one
of the pass's passes are all answered), which the wait draws as the
pencil going over that code. After the pass, as Jev chooses what each thing
stands as and composes what it raised, it sends what each answer settled
(stage `standing`: the files and areas whose things Jev chose, and those
whose building, landmark, land or sky it composed, each once), which the
wait draws as one more stroke. Every file is named once, before the
document, whether or not Jev is asked. With every answer it also names the areas
whose judgments have all settled (stage `asking`, `settled`, the areas' paths:
an area settles once every request about its files, its entity and itself
has, and its region's own; its land is composed later, once the code is
understood), and the areas with a question to Jev in flight (`asking`). The wait (`app/renderer/wait/`) paints the field
map from these: each file's health as it settles (`settling.ts` works out
how much of the health at each of the land's cells is settled, and paints a
cell only once nearly all of it is), and each area's name once it settles,
where the field map letters it: both sheets place every area's name once for
the whole sheet with `nameLand` and `placeNames`
(`app/renderer/immersive/map-names.ts`) from the same land, the areas'
outlines and the lots, so a name keeps off every mark to come and the
compass rose's corner, and nothing about where the person stands moves it
(the field map reads the lots from the stood world's `lots`).
Once the world is laid out, the wait gets every file's vitality, all a world
laid out in the page itself ever sends it; the world then hands it
each building's and landmark's mark at its laid-out place
(`laidOut` in `app/renderer/terrain/world.ts`), and the stood world when the
bake returns, for its hills, water and trees.
`docs/connect-jev.md` is the reviewer's page for connecting it.

A world heals while it stands. Every 4 s the world service asks
`project.commit` for the folder of the world the page shows
(`COMMIT_EVERY_MS` in `app/world-service/index.ts`; a world read from disk
has no commits to watch), and on a new commit it opens the world again
exactly as above, with nothing shown and nothing asked of the person
(`healWorld` in `app/world-service/open-world.ts`, which runs `openWorld`).
The answers kept by request hash, Jev's in the store and the understanding
pass's in the engine, settle everything the commit left alone, so only what
it changed is asked. It sends the page each thing's new vitality where it
changed, by what it stands for (`world.vitality`), and the page sets it the
one way vitality changes while a world stands (`setVitality` in
`app/renderer/terrain/world.ts`, see Vitality). The world laid out takes it
too (`withVitality` in `@gaia/world`), so the field map is washed again
while the page is idle, the open journal page redraws, and each changed
thing is painted afresh, its old painting shown until the new one is done.
Only vitality changes live, never shape, and the forms Jev picks for what
changed are kept for the next open and shown only then. When the new code
lays the land out exactly as before (the same files, lengths and
definitions, each definition on the same lines), the journal also moves to
the new commit's code and judgments (`world.vitality`'s `commit` and
`judged`). A commit that would move anything (a file added, removed,
renamed or resized, a definition moved) heals only the things that still
stand under the same name, and the reshape, the journal's new code and its
judgments wait for the next open. A heal never asks the person anything: one
costing more than their spend limit fails, as does one Jev cannot be asked
for, and either waits for the next commit.

`placeAt(world, x, z)` in `@gaia/terrain` says where a person is: the cell
whose site is nearest the warped point names the area and the file underfoot
(`WorldPlaces`, in `@gaia/schema`); a lot's cell names its area and no file.
Past the land's rounded square (`WorldPlaces.size`) is the wild, which stands
for no directory. `outlinesOf(world)` traces every area's and
patch's outline from `placeAt`, once per world, for anything that draws them
(the field map draws each patch's own shape).

In the app, the page opens on the world the world service sends. With no
folder named, the world service answers the page's `world.open` with
`world.start`: the worlds opened before (`RecentWorld`, kept newest first in
the app's `settings` table under `recent-worlds`, each with a painting of
where the person last stood still in it), and the page shows
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
(`world.opened`) so a reload reopens it. Whenever the person in a world the
service opened stands still 2 m or 20 degrees from where it was last
painted, the first time as soon as the world shows, the page takes their
own view (`WorldHandle.look`, at the journal's afternoon hour) and paints it
on a painter's thread as the journal paints (`paintKept`), 1,040 pixels wide
and as deep as the land's shape makes it, about 60 KB of WebP. It sends it
as `world.painting`, and the service keeps it with the recent world that
page opened (`RecentWorld.painting`, a data URL), one write after another so
it never races the visit; a world opened again keeps it until a new one
comes. The store reads only a WebP data URL of at most 256,000 characters.
The painting is offered whatever the code is now: a next open lands where it
was painted while the code lays out the same, and beside the same thing
once an edit has moved it (`returnTo`, below). Each recent world also keeps
the commit the person last opened it at (`RecentWorld.commit`). A world kept
before paintings were, or left before the person stood still in it, comes
with no painting, which the start shows as a card of the wait's own bare
sheet, in the sheet's shape, with its name, so it rises into the sheet as
the sheet. When its code has moved on since the person last
opened it, the start is also told how many commits have touched the folder
since (`project.commits`, `RecentWorld.commitsSince`), which the card tallies.
As the person walks, the page sends where they
stand (`world.stood`, a `StoodSpot` from `stoodBy` in `@gaia/terrain`):
their spot and facing, the world's layout key, and the nearest thing that
stands for code, by its path, with where it stood. It sends one once they
have moved 2 m or turned 20 degrees, as soon as they stand still or every
30 s while they walk, and when the page goes. The service keeps it with the
recent world (`RecentWorld.stood`), not in the project's own store, which
holds Jev's answers and is rewritten whole on every write. The next open of
that world sends it with the document (`world.document`'s `stood`), and the
page lands the person by it (`returnTo`). A world that falls out of the six
recent worlds forgets it. A page with no world service keeps none. A card the wait's sheet takes turns over
in its place as soon as the land is divided, bending as the journal's leaves do (`curl.ts`), onto its back,
the sheet's bare paper, and the map is drawn there. A
standalone page (`pnpm lab:html`, `pnpm lab:serve`) has no engine and opens
on Gaia's own world from `app/renderer/terrain/fixtures/gaia-graph.json`,
the engine's judged graph `pnpm graph-snapshot` writes, laid out from the
facts `factsOf` derives from it, judged
by Jev's answers kept for that snapshot in `fixtures/gaia-jev.json` (written
by `pnpm jev-world`, which judges and composes it, keyed by request hash like
the app's store) alone: a request they no longer answer fails the page,
naming it, until `pnpm jev-world` keeps its answer. The page lays the snapshot out
on a thread of its own (`app/renderer/terrain/layout-worker.ts`) while the
wait draws. The app never falls back on it: a folder the world service cannot
open says why on the wait. Beside those fixtures, `fixtures/gaia-graph.json` holds the
engine's graph of the same commit, which the layout is moving onto. `pnpm
graph-snapshot` writes it, trimmed by `judgedGraph` to directories, files
and definitions, each with the importance and quality Jev's held answers give it,
the imports between files and the calls and references into each definition
(the snapshot of this commit predates those, so on the page a definition's
building or landmark does not yet rise with what calls it).
`?world=proving` (and `GAIA_PROJECT=proving` in the app) shows the proving
ground: a made-up codebase (`fixtures/proving.json`) laid out with
`layoutWorld` from choices fixed to cover every option Jev is offered and
every look of its own (`fixtures/proving-judged.json`), both written by `pnpm proving`
(`tools/proving.ts`), so it holds every building and landmark thriving, tired
and in ruin, a whole area in ruin, streams crossed on footbridges and
stepping stones, cairns, ponds, a tiny area and deep nesting
(`docs/proving-ground.md`). `?world=showcase` (and `GAIA_PROJECT=showcase`)
shows the showcase, the world Gaia's film is walked through: a made-up
codebase named gaia, written as real code (`fixtures/showcase-code.txt`), read
by the engine and judged by Jev as any folder is, then carried like Gaia's
own snapshot (`fixtures/showcase-graph.json`, `showcase-judged.json` and
`showcase-jev.json`, written by `pnpm showcase --judge jev`), so it opens the
same with or without an engine, and the journal reads its code from what the
page carries (`docs/showcase.md`). `?world=showcase-fixed` is the same land
with the showcase's old `v1/` rewritten well and judged again
(`showcase-code-v1-fixed.txt` and the `showcase-fixed-*` fixtures, written by
`pnpm showcase --judge jev --v1 fixed`). `tourStops` (`app/renderer/terrain/tour.ts`)
finds in any world where to stand to see each such feature. `standWorld` takes the
layout (`StandRequest.code`): each building and landmark where its thing
stands (an entity's lot, a file's heart, a definition's plot), each
definition, file and entity that stands as a plant, a stone or flowers on
its own file's cells near where the layout put it (an entity's on its lot),
and the trails between entities, walked over one network of ways
(`Stand.network`: its ways of tread, the trails walking them, its junctions
and any trail dropped, with why), ending at a building's door, a landmark's
foot, or the lot's middle of an entity that stands as neither
(`StandCode.places`). Buildings and landmarks are sited first, and
everything else keeps off them. A building takes the gentlest dry spot on its
lot whose yard (the house, a margin round it, its walk and what stands
beside it) meets no yard laid before it, or its lot's middle when none is
free; where the water would stand above its pad there, or its yard would
meet another's, it takes the nearest such ground past the lot (`findSite`,
`yardsMeet`), so a house never stands in a pond, a stream or another house.
A landmark keeps off every building's walls and what stands beside them, and
where its lot's middle is taken it stands on the lot widened 6 m at a time
(`findLandmarkSite`). A thing that stands as a tree is one of the
woods' trees, sized by its importance, with its own vitality, and keeps its crown's width from
every other so each tree reads as one thing; any other stands as an
understory placement: a stone, a bush or a drift of flowers. Every one
stands: where its whole patch lies in the room trees keep round a house, a
trail or a landmark, it stands in that room, under a crown if need be.
Every tree, stone, bush and drift of flowers in a world from code is a
definition, a file or an entity Jev chose to be one, and a tap on one opens
its page.
Nothing else stands on the land: between the things that stand for code it
is grass, ground and water.

Everything that stands on the land stands by tile
(`app/renderer/terrain/standing.ts`). A component adds a stander: the size of
its largest thing, what stands in a tile, and how to stand a set of its
things. A thing is seen only while it spans a few pixels on screen (`GONE`,
`seenTo`), so a stander's tiles stand as far from the person as its largest
thing can be seen, up to where the air dissolves the land at 1.4 km, and go
200 m past that. A tile's things come at once from the world's plan, and a
stander stands again when its tiles change, one stander a frame. The trees, the trails'
crossings, cairns and edging stones (a way's stones a 256 m square at a
time), the buildings and the landmarks are standers. A building far off
keeps no meshes: its build is made on a worker before its tile stands
again. A jump and an opening wait for the tiles around the person. A new
component stands by tiles by adding a stander. The stones, bushes and
flowers that stand for code stand wherever the person is, each showing the
vitality of what it stands for (`understoryVitality` in `stand.ts`). The
ground textures take a world of any size.

## The code graph

The engine is being rebuilt to read every language the same way
([decision 53](decisions/53-the-code-graph.md)). What it produces is the
code graph (`CodeGraph` in `packages/schema/src/graph.ts`), which
`project.graph` returns:
- a node for every directory, file, definition and block;
- an edge for every import, call, reference and implementation between
  them;
- each node's lines, each file's and directory's history from git, and
  Jev's judgments of each node;
- each directory's entity: the package or crate its manifest declares,
  and nothing else (`entities.rs`); and whether a definition is exported
  (`export`, or Rust's `pub`). An import that spells a workspace package's manifest name, or a
  subpath through its exports, resolves to that file by rule.

Each edge says who filled it: a rule, or Jev with its probability. A
node's id comes from its path and name. Its lineage stays the same through
renames and moves, and the world is to seed geometry from it.
Three store tables hold Jev's side: `calls` keeps raw responses by request
hash, `held` the answer the graph shows for each question by lineage, and
`lineage` the last graph's lineage map and definition fingerprints.

`project.graph` reads the snapshot and parses every file whose
extension the language table names (`engine/languages.toml`). Twenty-one
languages are compiled in, from TypeScript to YAML, and the table is the
engine's only knowledge of them. For each file the engine runs the
grammar's own tags query, when it ships one, and then our query file in
`engine/queries/`. One loop (`engine/src/graph/parse.rs`) turns every match
into the graph by its capture name:
- `@definition.<role>` becomes a definition, with its signature, its doc (a
  docstring, or the comments directly above it), its owner (a Go receiver, a
  Rust impl, an enclosing class) and its parent. A definition inside a
  function is kept only when it runs or holds definitions itself.
- `@block.<shape>` becomes one of ten kinds of block: branch, loop, match,
  try, closure, scope, concurrent, unsafe, data and markup.
- `@reference.import` and `@reference.call` become pending references.

Any other language loads at runtime as WebAssembly, through tree-sitter's
`wasm` feature, from the `.wasm` file its grammar's own release publishes.
The table names that file and its SHA-256, and the grammar's tags query when
it has one. The engine downloads each the first time a project needs it,
checks the hash, and keeps it in `<data>/grammars/`. Apart from Jev and
`project.clone`, this is the engine's only network use; without a network,
those files are read as having no grammar. Lua, Elixir, Scala, Zig, Haskell
and OCaml load this way today. With no query file of ours, such a language
falls back: its tags query finds definitions and calls, and node kinds most
grammars share, such as `if_statement` or a node with a `name` field ending
in `_declaration`, give blocks and, with no tags query either, definitions.

Every node gets its lines, and each file and directory its history from git:
its commits, those of the last 14 days, and its authors. A file whose path
matches one of its language's conventions, such as Go's `*_test.go`, is
tagged with it as evidence for Jev; no file name decides anything. A file
with no grammar is still a node, with its lines, size, hash and history.
`unparsed` counts what a grammar could not read, such as TypeScript 5's
`export type *`, which tree-sitter-typescript 0.23 does not know. Parses are
kept by content hash while the engine runs, and Gaia's graph builds in under
a second.

Then the rules (`engine/src/graph/resolve.rs`) turn each import and call
into an edge when exactly one target fits. Anything with several
possible targets goes pending, with every candidate, for Jev. Anything with
none is outside the repository and gets neither:
- An import's relative forms resolve from where they point, by the prefixes
  the language table lists, such as `./`, Python's leading dots and Rust's
  `crate::`. Other forms resolve when exactly one path ends with all their
  segments, as `click.core` names `src/click/core.py`. An import that names
  a directory points at the directory. A package name goes to Jev with the
  directories whose configuration mentions it.
- A call or reference looks for definitions with its name in the caller's
  language family: first in its own file, then in the files it imports, then
  in its own directory. What the call names before its name narrows the
  candidates: an owner (`Batch::new`), a file or package (`utils.join`), or
  `self` and its kin for the caller's own class. An unqualified call never
  reaches another class's method, except in languages whose methods call
  their own class's without `self`. A definition inside a function is local
  to it, and a macro call reaches only a macro. A receiver the rule cannot
  place, such as `err` in `err.Error()`, sends the call to Jev.

On a hand check of the bench, 175 of 175 imports and 199 of 200 calls the
rules resolved were right (`tools/bench/labels/`).

Every directory, file and definition has a lineage, which it keeps through
renames and moves (`engine/src/graph/lineage.rs`); a block's lineage is its
holder's and its place there. When a project opens, the engine matches the
new graph to the last one it kept, in the store's `lineage` table:
1. the same id;
2. git's renames, composed commit by commit;
3. definitions moved by body, whose fingerprints agree on 85%, or 60% under
   the same name;
4. files by their text;
5. files following their definitions;
6. directories following their files, and a file in a moved directory
   keeping the lineage of the old file of the same name.

Anything else gets a fresh lineage. `pnpm bench --replay` replays a
repository's history. click's "move to src" commit keeps the lineage of all
1,260 of its definitions, where ids alone keep 52%. A year of its history,
a step a month, keeps the lineage of 1,817 of the 1,823 definitions that
still exist.

The lineage record lives in the project's store, under the project's id:
its repository's root commit, so a clone anywhere finds it. A folder
inside a repository is a project of its own, named by the root commit and
its place in the repository, so opening a subfolder never takes the whole
repository's record or answers.

The graph's name, which every request to Jev carries as `repository`, is
the repository's own: the last part of its `origin` remote's address, or
with no remote its main checkout's folder. A worktree or a branch never
changes it, and it plays no part in telling projects apart.

The world reads the graph alone. Updating a world while its files
change on disk comes last, once the world is right without it, because it
complicates nearly everything else.

## The Jev runner

The engine asks Jev about the code graph itself, so a call never sends
anything on its own and every answer lands in one place. The protocol has
two methods:
- `understanding.plan` builds every request Jev would be sent about a
  project and looks each up in the store's `calls` table. It sends nothing.
- `understanding.next` sends whatever is ready, in slices, and returns the
  nodes that settled, and the quality of each file settled for good, so a
  waiting screen can paint each as it lands. A file is settled for good once
  nothing more will be asked about it: its requests, planned anew on what
  is held now, are all answered, since an answer that asks for readings
  brings a request of its own.

`project.graph` with `judged: true` builds the graph with Jev's links and
includes every answer the project's store holds for the calls the engine
asks ([decision 54](decisions/54-understanding-in-slices.md)). Opening a world
uses them. `openWorld` divides the land on `project.graph` with `judged:
true` as soon as the graph exists. Only under a spend limit does it plan with
`understanding.plan`, which takes several times longer, to weigh the cost.
Once Jev has judged the looks, it calls `understanding.next` until nothing is
left, counting its requests on the wait with judging's, and sends what each
slice read and each file's health as a slice settles it for good. It reads
the graph again only if the pass asked something, and then reads the facts
from it again too: the pass's link step resolves the imports and calls only
Jev can, which change a file's importers, an area's imports and an entity's
dependencies. It asks the looks again on those facts (the answers kept,
this opening's among them, settle every look that did not change), so a
first opening asks and lays out exactly what a reopening from the same
answers does. It lays the world out on
`project.graph` with `judged: true`, both graphs trimmed by `judgedGraph`,
so every definition stands by Jev's importance and vitality is Jev's
quality.
The world document carries what the pass judged (`WorldDocument.judged`, a
`JudgedThing` for every folder, file and definition: its quality, its
importance and each concept, every score from 0 to 1, and the blocks Jev
picked by their lines), for the journal. A plan counts understanding's requests
before Jev's links are in, built on the graph as it stands, so the cost the
person sees includes them; they go out only once the links are.

The runner (`engine/src/jev/runner.rs`) makes one request per file or
directory in each pass. A file's request holds its source, an outline of
its definitions, and every applicable call's part and questions. Each call
(the links' in `engine/src/jev/calls.rs`, the understanding pass's in
`engine/src/jev/axes.rs`) names, for every question, the node it is about
and where its answer goes in that node's `judged`. Its words live in its
vocabulary file in `engine/vocab/`, and its version is their hash. A pass
waits for the one before it:

| Pass | Calls | Asks about | Waits for |
| --- | --- | --- | --- |
| link | `resolve`, `callee` | each import or call the rules left with several candidates | nothing |
| folders | `folder-axes` | each folder, the root first | every link request, and its parent folder's request |
| files | `file-axes` | every file that is text | its folder's request |

A link answer becomes an `imports` or `calls` edge filled by Jev, with its
call and probability; "outside" drops the reference. It is held with the
candidates it chose among, and holds only while they stay the reference's
candidates and its call's version is current: when a new file offers another
target, or the call changes, the reference is asked again. A reference keeps
an answer for each set of candidates it has had, since other links can
change its candidates (a call whose receiver's type comes from an import Jev
resolved, say); with one answer per reference, applying one answer could
undo the other on every slice.

A request stays within 30,000 tokens as `engine/src/jev/tokens.rs`
estimates them, deterministically, so a request is laid out the same way on
every open and its stored answer is found again. A file that doesn't fit is
cut at its top-level definitions into pieces sized by their source and
their questions together, so its source goes out about once; a definition
too long for a request is cut at its lines, and a line too long alone, such
as a minified bundle's or a generated JSON file's, at character boundaries.
A piece of a cut line says which characters it holds: its `chunk` gives its
first and last lines and, as `characters`, how many characters of its first
line come before it and how many of its last line it reaches, the line
break not counted. A question about a definition, a block or a reference
goes in the piece that holds its line, and on a cut line a definition's in
the piece that holds its signature. One about the whole file goes in the
first piece, which holds the whole file's outline, and in any piece asked
about nothing it holds, so every character is read; their answers combine
by the bytes each piece read. A piece carries only the parts of the calls
it asks. A link question offers every candidate within 3,000 tokens, a
tenth of a request; one with more offers the nearest to the file asking,
by shared folders, as many as fit, and its answer is held under all of the
reference's candidates, as the graph finds it. A folder names each
subfolder's files within an eighth of its parts' room and counts the rest,
and a folder whose parts don't fit one request is asked in several, each
with a run of its parts (`partsHeld`) and the questions about them; the
folder's own questions go with the first. A request already
answered (the store's `calls` table, by the request's hash) is never sent
again. A fresh answer replaces the one held for a node's lineage (the
`held` table) only when it clearly differs: a choice by 0.2, a score by
half a level. Up to 64 requests go at
once; when Jev says it is overloaded, half as many, and 8 more after each
slice it takes without complaint.

### The understanding pass

The understanding pass (`engine/src/jev/axes.rs`) asks importance and
quality at every level, with every word, level, weight and pick in
`engine/vocab/understanding.toml`. After the link pass, folders go top-down,
the root first and each folder once its parent's request is answered, and
each file once its folder's is. So every request carries the project's own
words (the opening of the root's largest Markdown file) and what was found
above it, as typed answers: each enclosing folder's importance and its own
quality concepts, and, for a file, its own importance as its folder judged
it.

A folder's request scores each of its files' and subfolders' importance and
its own quality concepts. A file's request, with its source and its
neighbours' signatures, scores each code definition's importance and every
quality concept, picks which block of each definition with two or more is
key and which most needs work, and scores the file's own concepts. The
definition a file's page leads with is the one Jev judged most important
(the journal chooses it; see `docs/design-system.md`), so files have no
picks of their own. A file too long
for one request is cut at its top-level definitions; the whole-file
questions go in the first piece and in any piece asked about nothing it
holds, so they take no room from the others. Definitions whose role is
data or markup (a CSS rule, a Markdown section, a JSON key) are never asked.
Every request ends with a choice of what more would help: where it is used,
the source of what it calls, its tests, or its folder's docs. Each reading
Jev wants above the threshold is added, and the same questions are asked
again, up to the set number of rounds.

The engine then works out `judged.value` for every folder, file and
definition: importance as its container judged it (the root is 1), and
quality as the weighted mean of its concepts, gathered upward with each
container's top-level parts weighted by their lines and blended with its
own.

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
- stores every accepted answer, keyed by the hash of the whole request
  (model, facts and questions), and asks again only when the request
  changes.

### What a request carries

There is one way of asking, from the code's structure
(`planWorldRequests` and `planStanding` in
`packages/world/src/code-world.ts`):

- **State.** Summary facts with every count and size in words
  (`fileWords`, `areaWords`, `entityWords`): a file says what it declares,
  its size and how many files it imports and is imported by; an area
  compares its size and its imports per file with the repository's other
  areas (`comparedWithOtherAreas`), because Jev answers each area's request
  alone and cannot see that "much of the code leans on" one area more than
  another. Sizes are words and line numbers are left out, because a
  request's key is the hash of what it sends: a one-line edit asks about
  0.02 requests again.
- **Questions.** Each area is asked whether its land holds water, each
  option a reason drawn from how its code imports; each entity, which of
  its dependencies a person would walk a trail along (`dependsOn` says how
  many of its files import each). What every entity, file and definition
  stands as is asked on its own after the understanding pass
  (`planStanding`: `form` for a file or an entity, `form#<qualified name>`
  for a definition, `LAYOUT.formsPerRequest` to a request), among the forms
  its rank by importance is offered, so what each stands as is Jev's call.

Asked alone, with 13 others or in reverse order, a question's
probabilities moved no more than asking it twice (0.07 at most), and
reordering every option moved 2 to 6% of judgments, no more than asking
twice: with options shuffled per thing, Jev shows no lean toward the first.

The engine is Jev's only client (`engine/src/jev/client.rs`). It posts each request
to OpenRouter's Decisions API with curl, the key read from the macOS Keychain
(service `gaia-openrouter`) and handed to curl on stdin, never on a command
line or over the protocol. `jev.batch` sends many requests eight at a time
and answers each with Jev's response or the reason that request failed;
each response carries the cost and input tokens OpenRouter billed
(`costUsd`, `inputTokens`) and its time. It refuses unless the engine runs with `GAIA_JEV=live`. curl retries a timeout, 429 or
5xx twice and gives up on a request after 90 seconds. `jev.status` says
whether the Keychain holds the key, asking only whether the item exists, and
whether the engine is live. Tests point the engine at a local stand-in for
OpenRouter (`tools/openrouter-stand-in.ts`) with `GAIA_JEV_ENDPOINT`, which
accepts only a loopback address; a local endpoint is sent a placeholder key
and the Keychain is never read, so the key can only go to OpenRouter.
`jev.estimate` returns what a batch would send and cost without reading the
key or touching the network: tokens are estimated at 1.8 bytes each, from
OpenRouter's published example, and priced at Jev 1.13's $0.042 per million
input tokens (output is free). `pnpm print-world-requests` prints every request judging Gaia's own
world would make, with that estimate.

## Vitality

A thing's vitality is Jev's quality (`judged.value.quality` on the engine's
graph): a file's and a definition's are their own, an entity's is its
folder's, and a file the pass didn't judge takes its nearest judged
folder's (`layoutWorld`). A world no graph judges, such as the proving
ground, takes the quality fixed with its looks (`Judgments.quality`), and a
thing nothing judged, as in a world opened without Jev, is whole. A card
shows a thing's vitality as a percentage.

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
green, and `groundLook` is the rule they follow. The page's thread reads
the same values through `vitalityAt`, the CPU twin of the texture's
filtering. A change in vitality
rewrites the texture's bytes (about 3 to 9 ms on the page's thread for
Gaia's world) and never rebakes. Vitality changes while a world stands
only through `setVitality` in `app/renderer/terrain/world.ts`, by what each
thing stands for, which the map, the journal and its paintings follow: a
heal (above), and the hook `__lab.terrain.fileVitality(path, v)`, which
sets a file's vitality and its
definitions', or every file's under a directory, on what stands for them,
their ground, and their areas' lots and water; `__lab.terrain.groundVitality(x, z)` reads the texture as the
shaders do.

Every primitive writes five per-vertex vitality channels: `loss` (the vitality
below which a piece collapses to its pivot, or a spray's leaves drop in
place), `droop` (how far its bough sags about the bough's joint), `wither`,
`glow` and `pivot` (the point the piece hangs from), and what carries the
vertex: `bough` (the joint where its bough or stem leaves the trunk or the
ground) and `twig` (where its twig leaves the bough), which wind and droop
bend it about, plus a `tint` hue offset, a `cutout` that places a vertex on a
leaf card or marks a fir frond's solid heart (`CUT.core`), and `close`, how far a piece folds toward its pivot at night (a
flower's petals). Parts may add six optional channels for ruin and motion:
`fall` (an axis, the most it turns, and the vitality below which a piece tips
about its pivot: a door swings ajar, a chimney topples), `grow` (the vitality
below which a piece grows out of its pivot: ivy, weeds, rubble, boards over
windows), `rot` (how far a surface rots through into ragged holes, cut per
fragment from a noise fixed to the piece), `grain` (where a vertex lies
across and up its surface's courses, in pieces, and what the surface is:
tiles, straw, plaster, stones or boards; each piece then reads the rot's
noise at its own middle and goes whole, so a hole's edge steps along the
courses) and `spin` (an axis and a rate a
piece turns at while alive, slowing to a stop as vitality falls: a mill's
wheel) and `roost` (how fully a piece flies home onto its pivot as dusk
falls, over the hours the lamps are lit in, and out again after dawn: a
dove). A part without them carries none, and only its material compiles
them in. The plant shader combines them with each instance's live
vitality, so a change in vitality never rebuilds geometry. A change eases
in: each plant, batch, copy and far card holds a shown vitality that
follows the one it was given and, behind it, where that was
(`uVitalityLag`), both moved once a frame by the frame's own time by
`easeVitality` in `packages/render/src/lag.ts` (`CHANNEL_MATH.vitalityLag`
seconds per stage); the shader shows each step averaged between them
(`eased`, mirrored by `easedStep` in `@gaia/realize`), so a change starts
and stops gently, and at rest both equal the vitality given and the look is
unchanged. A component placed
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

The grass draws all its 150,000 blades in one call (`createGrass` in
`app/renderer/terrain/cover.ts`). A blade past its own thinning band, where
it has narrowed to nothing, or lying wholly outside the drawing camera's view
skips the rest of its vertex shader and draws nothing, as it drew before, so
most blades cost a few instructions.

What drifts through a region's air (`createDrifts` in
`app/renderer/terrain/drifts.ts`) draws as one set of points a form, and only
for the forms some region's biome holds. Once a frame the page works out
which trees near the person drop leaves and petals and how many. For the
fireflies it keeps a small texture of how full the air is round the person,
13 samples a side 8 m apart on a grid fixed to the world, from each region's
weight (`regionWeights`) raised to the 12th power, and refills it only once
the person is 16 m from its middle, about a millisecond. The shader places
each point from `uEye`, the wind and the land's clipmap, and thins a firefly
by that texture, the wild's share and the ground's decline where it floats,
so the page moves nothing but a few uniforms. The water's mirror and the
sun's shadow leave drifts out.

`createPlantInstances` in `@gaia/render` draws many copies of one plant, one
instanced mesh per part and level, and `draw` packs the copies it is given
into each level's instance buffer. Which copies draw, and at which level, is
the world's (`createCopies` in `app/renderer/terrain/woods.ts`): it sorts
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
(`farness` in `packages/render/src/far.ts`), the card draws over the full tree as far into its
form as the crown is into the band. Past the band, down to 128 / 1.15 (about
111) pixels (`FAR.leave`), the full tree still draws under its card, now
drawn whole, and dissolves (`nearLeaves` in `packages/render/src/instances.ts`):
its leaves thin through their own coverage, its bark is screened away pixel by
pixel, so whatever the card does not cover, such as a willow's strands or a
fir's needles, is gone before the full tree stops drawing. A tree never
changes form in one frame. The sun's shadow, a flat pass, keeps the full form
only to the band's end, where the card starts to cast. Trees turn far at
the same size however dense the view: detail never gives way to the frame
rate. The woods choose only the full form; each card chooses itself. A
plant's copies stand in its cards' instance buffers (`FarCopies`), written
only when the copies stand or a vitality changes, and before each pass the
far cards are told only the pass's focal length and whether it is flat. The
card's vertex shader measures its copy's crown on that pass's screen and
draws it whole, fading over its full form, or not at all, by the rule the
woods choose the full form by (`farChoice`, and its twin `FAR_CHOICE_GLSL`),
so no far copy costs the page's thread anything per pass. Each form draws
in one call per set (solid and fading) for each plant per pass. Nothing past
`AIR.dissolveEnd`, where the air has dissolved everything into the sky,
draws at all. The understory's shrubs, rocks and drifts of flowers and the
wild's bushes take far forms too, baked and turned far at a quarter of the
trees' size (`FAR.bush`, set per understory group). Whatever its form, a
thing whose crown spans fewer than 8 device pixels dissolves through its
own dissolve, and by 4 it is gone (`GONE` and `goneAt` in `woods.ts`, which
`standing.ts` reads too); a cell whose largest crown spans under 4 pixels at
its nearest point draws nothing. Every plant that turns far is listed once in `createFarForms`,
in the far cards' form order. Each build bakes into its far form a few views
a frame under the wait (`startFarBake`), and the wait lifts only once all of
them are ready. A baked form is kept in the
browser's IndexedDB (`app/renderer/terrain/far-store.ts`), keyed by a hash of
the build and the swap size, so each build bakes once. The database's version
is the bake's (`FAR_BAKE_VERSION`), so the first open at a newer bake empties
the store of forms no bake reads again. A second, small store records when a
visit last read or stored each form, and each open deletes the forms no visit
used in the 30 days before the last one, such as those of a season no world
wears any more, reading only keys and times. A
form read back from the store keeps its pixels in the page only until the GPU
holds them (`farFormFrom`'s `onUpdate`). The land's textures are laid on the
page from what it holds anyway: the clipmap's levels from the bake's arrays
and the ways, the clearings' window from the outlines and capsules. Besides
its levels, the clipmap keeps only the trails' distances, in 16 bits.
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
  plus an addition. Seeds come from paths. The code graph already gives every
  node a lineage that survives renames ("The code graph"), and the world is
  to seed from it once it reads the graph.
- A blueprint's ID is a hash of its contents, so equal answers name the same
  blueprint.
- Reopening a world asks Jev only about requests it has not answered: the
  world is laid out again from the code and the kept answers. The world
  document itself is not stored yet.
- A world that stands follows a new commit in its folder the same way, but
  shows only the new vitality; its shape and forms follow at the next open
  ("A world from code", `healWorld`).
