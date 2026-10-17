# The proving ground

The proving ground is a world built from a made-up codebase, so every feature
a world can show is somewhere in it. Gaia's own world has no ruined area, no
bridge and only a few kinds of building; this one has all of them, at every
health. Test a change here as well as in Gaia's own world.

## Opening it

- The lab: add `?world=proving` to the page (`pnpm lab:html out.html`, then
  open `out.html?world=proving`).
- The app: `GAIA_PROJECT=proving pnpm dev`. The page lays the world out
  itself, so no folder is opened; File > Open Folder leaves it.
- Scripts: `__lab.terrain.tour()` lists every stop below, and
  `__lab.terrain.tour("ruined bridge")` walks to one and looks at it.
  `__lab.hour(22)` sets the hour.
- Shots: `pnpm shots` photographs every stop, and one thing standing as
  each tree, bush, stone and flower form, at vitality 1, 0.5 and 0.1 by day
  and 1 at night (`tools/shots.ts`).

## What it is made of

`pnpm proving` (`tools/proving.ts`) writes two fixtures from one plan:

- `app/renderer/terrain/fixtures/proving.json`: the facts the world is laid
  out from (`CodeFacts`), as `factsOf` derives them from a codebase's graph. It has 126 files and 32 entities in a
  970 m world of 12 lands and 45 areas.
- `app/renderer/terrain/fixtures/proving-judged.json`: the choices Jev would
  make about it, fixed so that every water, character and form (the trees
  among them) in `app/renderer/terrain/looks.ts` is used, every drift
  (`drift@1`'s forms) drifts through some area's air, and every land, trail,
  building and landmark of its own (`tools/proving-looks.ts`) is used, each
  building and landmark thriving, tired and in ruin.

`pnpm proving --code DIR` writes the proving ground's code instead
(`tools/proving-code.ts`): real source for each planned file, as poor as its
health, and beside it a manifest (`DIR-manifest.json`, or `--manifest
PATH`) that says how each source file was written: which faults it was
given, and how badly. A few ruined files have names that say nothing (`ruins/oak/temp.ts`,
`ruins/house/utils2.ts`), as poorly kept code does.

- A thriving file is small, named, documented steps, and its tests pass.
- A ruined one is long tangles with letters for names, docs about something
  else, emptied error handlers, state hidden at module level, unrelated
  helpers and shims marked HACK, and its tests fail.

The engine's bench writes it under `node_modules`, so Gaia's own world never
reads it, and parses it with the other repositories.

The lab lays these out with the real `layoutWorld`, `standWorld` and bake, so
the proving ground looks as any codebase's world would. Its vitality is the
quality fixed with its looks (`Judgments.quality` in `proving-judged.json`),
as Jev's quality would give it: each file's by its planned health, from 1 for
thriving to 0.03 for ruin, and each entity's its own files' pooled by their
lines. Its facts still read as its health would: a ruined file has failing
tests, compiler errors, deep nesting, lint warnings, TODOs and nothing
importing it.

Directory names say what each area is for, so the minimap's name tells you
where you are:

| Area | Land | What is there |
| --- | --- | --- |
| `crossings` | Brook valley, a brook, deep wood | A thriving wood, its trees dropping some leaves. A footbridge joins the cottage on the west bank to the house on the east. |
| `fords` | Meandering vale, a trickle | The trail from the croft on the jetty to the stone ring on the gravel crosses the trickle on a footbridge. |
| `ruins` | Brook valley, a brook, deep wood | A whole area in ruin: dead trees, a ruined footbridge, stepping stones and cairn, and eight of the ten kinds of building and landmark in ruin. Its land is given many falling leaves, and its dead trees drop none. |
| `mixed` | Clover hills, deep wood | Thriving files beside a failing grove (`failing-grove.ts`), and tired entities. |
| `hollow`, `pondside` | Mossy basin and pond meadow | Ponds. The hollow's lantern tower is the hub most trails lead to, so they meet at cairns. Many fireflies come out over the hollow after dusk. |
| `hills`, `terraces`, `moor`, `dunes` | Clover hills, silver terraces, heather moor, golden dunes | Each remaining land without water, so its landform shows. Petals fall from the hills' trees, motes of light hang over the moor and dandelion seeds float over the dunes. |
| `downs` | Broad downs | The thriving area, with `downs/tiny` (one 4-line file) and `downs/deep/…/bottom`, nested six deep from thriving to ruin. |

## The tour

`tourStops` (`app/renderer/terrain/tour.ts`) finds each stop in whatever world
is shown, so the tour works in any world. In the proving ground, these are
where each stop looks (x, z in meters from the middle):

| Stop | What is there | Looks at |
| --- | --- | --- |
| `bridge` | A footbridge in `crossings`, whose ground is at vitality 1.00 | 62, 269 |
| `ruined bridge` | A footbridge in `ruins`, whose ground is at vitality 0.13 | 173, 17 |
| `stepping stones` | Stepping stones in `ruins`, whose ground is at vitality 0.03 | 237, -33 |
| `cairn`, `ruined cairn` | Cairns where three ways meet, at vitality 1.00 and 0.05 | -56, 254 and 266, 14 |
| `pond`, `pond 2` | The ponds of `hollow` and `pondside` | -230, 398 and 59, -424 |
| `ruined building`, `thriving building` | The ruined timber frame house of `dunes/ledger`, the thriving fieldstone house of `terraces/croft` | -322, -184 and 457, 209 |
| `ruined landmark`, `thriving landmark` | The great tree of `ruins`, the standing stones of `moor/henge` | 189, 111 and -465, 207 |
| `thriving grove`, `failing grove` | The 4 trees of `crossings/channel.ts` and the 4 dying ones of `mixed/failing-grove.ts`, each a definition | 29, 296 and 356, -205 |
| `thriving area`, `failing area` | `downs` and `ruins` | -247, 31 and 255, 36 |
| `large area`, `tiny area`, `deep nesting` | `ruins`, `downs/tiny` and `downs/deep/deeper/deeper-still/deepest/bottom` | 255, 36; -82, -23; -390, -89 |

Every building and landmark also has a stop named by its kind and health,
such as `watermill (thriving)`, `watermill (tired)` and `watermill (ruin)`:
archive tower, battlemented keep, great oak, great willow, lantern tower,
stone croft, stone ring, storybook house, thatched cottage and watermill.

## What it shows and what it does not yet

Decline shows on trees, buildings, landmarks, footbridges, stepping stones,
cairns, trail wear, the understory's forms, the grass, the ground and the
water, and the paper of the minimap and the field map. In `ruins` the grass
has thinned to straw over dry ground with bare earth between, and the brook
runs brown and still; under `mixed/failing-grove.ts` one patch has dried
while its neighbors stay green.

Every other definition of its source files stands as a tree, going round
the four kinds, so it grows trees on every file at every health. In Gaia's
own world Jev chose a tree for about one definition in ten (236 of 2,398).

## Changing it

Edit the plan in `tools/proving.ts`, and its own looks in
`tools/proving-looks.ts`, and run `pnpm proving`. It refuses to
write a plan that leaves an option unused or lays out differently from what
it names. `app/renderer/terrain/proving.test.ts` then checks that the world
still crosses its streams on footbridges and stepping stones and has cairns,
thriving and in ruin. A change to how land divides, how rivers route over
it or how trails route can move a stream away from the trails that crossed
it, or entities off its far banks: rename a planned directory
to move it (a directory's place is seeded by its path), and check with
`__lab.terrain.tour()`.
