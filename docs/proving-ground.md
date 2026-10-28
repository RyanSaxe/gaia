# The proving ground

The proving ground is a synthetic world for visual coverage. Its plan includes
water, crossings, buildings, landmarks, trees and understory. Its sky, lands,
buildings, landmarks, trails, trees, bushes, stones and flowers sweep every
part Jev composes them from. Each part of each slot, and every frame with
every crown, appears at high, middle and low vitality, and each option of each
part appears somewhere. Use it alongside the [showcase](showcase.md) and
Gaia's own world in the app when changing rendering, placement or interaction.

## Explore it

Set `GAIA_PROJECT=proving` before `pnpm dev`, or open the
[standalone lab](development.md#the-standalone-lab) with `?world=proving`.
Neither path needs live Jev requests.

In the browser console:

```js
__lab.terrain.tour()
__lab.terrain.tour("ruined bridge")
__lab.hour(22)
__lab.terrain.sky(3)   // the sweep's fourth sky, until the next world opens
```

The world opens with the sweep's first sky. `__lab.terrain.sky(k)` shows sky
`k` and returns how many skies the sweep has.

The tour finds locations from the built world. It includes crossings, ponds,
cairns, groves, large and tiny areas, deep nesting, and each building and
landmark at several vitalities. Use the returned stops rather than fixed
coordinates, which can change with layout.

`pnpm shots` captures the stops and component forms at vitality 1, 0.65 and 0.3
by day, plus healthy forms at night, and the first stop under each of the
sweep's skies. Supply words such as `pnpm shots willow` or `pnpm shots sky` to
limit the captures. See [visual verification](development.md#visual-verification)
for performance and walking probes.

## Maintain coverage

| Source | Purpose |
| --- | --- |
| [`tools/proving.ts`](../tools/proving.ts) | Facts, health, entities, water and dependencies, and the places each sweep fills |
| [`sweep.ts`](../packages/world/src/sweep.ts) | The sweep of a kind's parts, and what a set of blueprints leaves missing |
| [`terrain/proving.test.ts`](../app/renderer/terrain/proving.test.ts) | Every part at every health, crossings, junctions and other world guarantees |

The lab, the app and the tests generate `proving.json` and
`proving-judged.json` in `app/renderer/terrain/fixtures/` from the plan when
they build. The files are not committed
([`proving-ground.ts`](../tools/proving-ground.ts)). They are generated again,
in about two seconds, only when the plan or anything it reads has changed.
`pnpm proving` writes the same files and prints what the plan contains. The
proving ground's judgments are fixed, so coverage does not depend on a model
response.

Each region's land is one place in the land sweep, labeled with its own
ground's health. The plan picks each region's water from the choices Jev would
see, and the water sets the landform as it does in the app. A brook or a
trickle makes the land a valley, and a pond makes it a basin. A region named
for a landform, such as `dunes`, takes that landform. Each building, landmark
and trail fills one place in its sweep, in the plan's order, labeled with its
health. A building can have a waterwheel only where its land has running
water. The trails that cross a stream come first, so their crossings alternate
between footbridges and stepping stones.

The build fails until every sweep is covered, and names each missing part,
option or health. A new part or option may need another directory in the plan.
When changing rivers, trails or placement, inspect the resulting crossings.
Paths or banks can move away from the feature the plan is meant to exercise.

## Synthetic source for engine checks

`pnpm proving --code DIR` writes actual source with faults that match the
planned health. It also writes a `DIR-manifest.json` describing those faults.
`--manifest PATH` selects another manifest location.

Healthy files have focused steps, useful names and passing tests. Poor files
include hidden state, unrelated helpers, misleading docs, swallowed errors and
failing tests. These faults are intentional test data. Keep generated source
outside Gaia's checkout or under `node_modules`, so Gaia does not analyze it
as part of its own world. `pnpm bench` generates it under
`node_modules/.cache/gaia-bench/proving`.
