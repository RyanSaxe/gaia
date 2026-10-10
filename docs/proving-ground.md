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

## What it is made of

`pnpm proving` (`tools/proving.ts`) writes two fixtures from one plan:

- `app/renderer/terrain/fixtures/proving.json`: the code model, in the shape
  the engine's `project.open` returns. It has 126 files and 32 entities in a
  950 m world of 12 lands and 45 areas.
- `app/renderer/terrain/fixtures/proving-judged.json`: the choices Jev would
  make about it, fixed so that every land, water, character, tree, form and
  trail look in `app/renderer/terrain/looks.ts` is used, and every building
  and landmark stands thriving, tired and in ruin.

`pnpm proving --code DIR` writes the proving ground's code instead
(`tools/proving-code.ts`): real source for each planned file, as poor as its
health, and beside it a manifest (`DIR-manifest.json`, or `--manifest
PATH`) that says by the engine's question names how each source file was
written. A few ruined files have names that say nothing (`ruins/oak/temp.ts`,
`ruins/house/utils2.ts`), as poorly kept code does.

- A thriving file is small, named, documented steps, and its tests pass.
- A ruined one is long tangles with letters for names, docs about something
  else, emptied error handlers, state hidden at module level, unrelated
  helpers and shims marked HACK, and its tests fail.

The engine's bench writes it under `node_modules`, so Gaia's own world never
reads it, and asks Jev about it to hold its questions to the plan.

The lab lays these out with the real `layoutWorld`, `standWorld` and bake, so
the proving ground looks as any codebase's world would. Health comes from the
facts, as it would for real code: a ruined file has failing tests, compiler
errors, deep nesting, lint warnings, TODOs and nothing importing it.

Directory names say what each area is for, so the minimap's name tells you
where you are:

| Area | Land | What is there |
| --- | --- | --- |
| `crossings` | Brook valley, a brook, deep wood | A thriving wood. A footbridge joins the cottage on the west bank to the house on the east. |
| `fords` | Meandering vale, a trickle | Stepping stones join the croft on the jetty to the stone ring on the gravel. |
| `ruins` | Brook valley, a brook, deep wood | A whole area in ruin: dead trees, a ruined footbridge and cairn, and eight of the ten kinds of building and landmark in ruin. |
| `mixed` | Clover hills, deep wood | Thriving files beside a failing grove (`failing-grove.ts`), and tired entities. |
| `hollow`, `pondside` | Mossy basin and pond meadow | Ponds. The hollow's lantern tower is the hub most trails lead to, so they meet at cairns. |
| `hills`, `terraces`, `moor`, `dunes` | Clover hills, silver terraces, heather moor, golden dunes | Each remaining land without water, so its landform shows. |
| `downs` | Broad downs | The thriving area, with `downs/tiny` (one 4-line file) and `downs/deep/…/bottom`, nested six deep from thriving to ruin. |

## The tour

`tourStops` (`app/renderer/terrain/tour.ts`) finds each stop in whatever world
is shown, so the tour works in any world. In the proving ground, these are
where each stop looks (x, z in meters from the middle):

| Stop | What is there | Looks at |
| --- | --- | --- |
| `bridge` | A footbridge in `crossings`, vitality 1.00 | 11, 249 |
| `ruined bridge` | A footbridge in `ruins`, vitality 0.05 | 255, 13 |
| `stepping stones` | Stepping stones in `fords`, vitality 0.57 | -193, -336 |
| `cairn`, `ruined cairn` | Cairns where three ways meet, in `hollow` and `ruins/house` | -251, 311 and 450, -67 |
| `pond`, `pond 2` | The ponds of `hollow` and `pondside` | -232, 390 and 63, -417 |
| `ruined building`, `thriving building` | The ruined croft in `ruins`, the thriving one in `terraces` | 125, -62 and 445, 206 |
| `ruined landmark`, `thriving landmark` | The keep in `ruins`, the stone ring on the moor | 173, -132 and -455, 119 |
| `thriving grove`, `failing grove` | The 14 trees of `crossings/flow.ts` and the 17 dying ones of `mixed/failing-grove.ts` | 5, 390 and 331, -251 |
| `thriving area`, `failing area` | `downs` and `ruins` | -237, 39 and 315, 73 |
| `large area`, `tiny area`, `deep nesting` | `ruins`, `downs/tiny` and `downs/deep/deeper/deeper-still/deepest/bottom` | 315, 73; -59, -11; -361, -86 |

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

It is also harder to draw than Gaia's own world: 479 trees grow on 950 m
against Gaia's 489 on 1,120 m, three of its lands are deep woods, and most of
its trees are willows, firs and cherries rather than maples. Where the hitch
probe starts, in `crossings`, a frame draws about 8.7 million tree triangles
against 0.85 million at Gaia's start, and the walk's median frame is 9.5 to
11.7 ms against Gaia's 8.3 ms. A codebase whose world grows woods like these
would stutter the same way.

## Changing it

Edit the plan in `tools/proving.ts` and run `pnpm proving`. It refuses to
write a plan that leaves an option unused or lays out differently from what
it names. `app/renderer/terrain/proving.test.ts` then checks that the world
still crosses its streams on footbridges and stepping stones and has cairns,
thriving and in ruin. A change to how land divides or how trails route can
move entities off the far banks of their streams: rename a planned directory
to move it (a directory's place is seeded by its path), and check with
`__lab.terrain.tour()`.
