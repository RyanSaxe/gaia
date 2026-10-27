# The proving ground

The proving ground is a synthetic world for visual coverage. Its plan includes
water, crossings, buildings, landmarks, trees and understory at healthy, tired
and ruined states. Its sky, lands, buildings, landmarks and trails sweep every
part Jev composes them from: each part of each slot stands thriving, tired and
in ruin, and each option of each part stands somewhere. Use it alongside Gaia's
own world when changing rendering, placement or interaction.

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

The world stands the sweep's first sky; `__lab.terrain.sky(k)` shows another
and returns how many the sweep holds.

The tour finds locations from the built world. It includes crossings, ponds,
cairns, groves, large and tiny areas, deep nesting, and each building and
landmark at multiple healths. Use the returned stops rather than fixed
coordinates, which can change with layout.

`pnpm shots` captures the stops and component forms at vitality 1, 0.65 and 0.3
by day, plus healthy forms at night, and the first stop under each of the
sweep's skies. Supply words such as `pnpm shots willow` or `pnpm shots sky` to
limit the captures. See [visual verification](development.md#visual-verification)
for performance and walking probes.

## Maintain coverage

| Source | Purpose |
| --- | --- |
| [`tools/proving.ts`](../tools/proving.ts) | Facts, health, entities, water and dependencies, and the places each sweep stands in |
| [`sweep.ts`](../packages/world/src/sweep.ts) | The sweep of a kind's parts, and what a set of blueprints leaves missing |
| [`terrain/proving.test.ts`](../app/renderer/terrain/proving.test.ts) | Every part at every health, crossings, junctions and other world guarantees |

`pnpm proving` regenerates `proving.json` and `proving-judged.json` in
`app/renderer/terrain/fixtures/`. These are generated from the plan and use fixed
judgments so coverage does not depend on a model response.

Each region's land is a place of the land sweep, labelled by its own ground's
health, its water settled as Jev's choice of water settles it: a brook's or a
trickle's land is a valley and a pond's a basin. A region named for a landform,
such as `dunes`, takes that landform. Each building, landmark and trail is a
place of its sweep in the plan's order, labelled by its health, and a building
may take a waterwheel only where its land holds running water. The trails that
cross a stream come first, so their crossings take turns between footbridges
and stepping stones.

The generator fails, naming each part, option or health missing, until every
sweep is covered; a new part or option may need another directory in the plan.
When changing rivers, trails or placement, inspect the resulting crossings:
paths or banks can move away from the feature the plan is intended to exercise.

## Synthetic source for engine checks

`pnpm proving --code DIR` writes actual source with faults corresponding to the
planned health. It also writes a `DIR-manifest.json` describing those faults;
`--manifest PATH` selects another manifest location.

Healthy files have focused steps, useful names and passing tests. Poor files
include hidden state, unrelated helpers, misleading docs, swallowed errors and
failing tests. These faults are intentional test data. Keep generated source
outside Gaia's checkout or under `node_modules` so Gaia does not analyze it as
part of its own world. The engine benchmark generates it automatically.
