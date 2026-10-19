# The proving ground

The proving ground is a synthetic world for visual coverage. Its plan includes
water, crossings, buildings, landmarks, trees and understory at healthy, tired
and ruined states. Use it alongside Gaia's own world when changing rendering,
placement or interaction.

## Explore it

Set `GAIA_PROJECT=proving` before `pnpm dev`, or open the
[standalone lab](development.md#the-standalone-lab) with `?world=proving`.
Neither path needs live Jev requests.

In the browser console:

```js
__lab.terrain.tour()
__lab.terrain.tour("ruined bridge")
__lab.hour(22)
```

The tour finds locations from the built world. It includes crossings, ponds,
cairns, groves, large and tiny areas, deep nesting, and each building and
landmark at multiple healths. Use the returned stops rather than fixed
coordinates, which can change with layout.

`pnpm shots` captures the stops and component forms at vitality 1, 0.5 and 0.1
by day, plus healthy forms at night. Supply words such as `pnpm shots willow`
to limit the captures. See [visual verification](development.md#visual-verification)
for performance and walking probes.

## Maintain coverage

| Source | Purpose |
| --- | --- |
| [`tools/proving.ts`](../tools/proving.ts) | Facts, health, entities, dependencies and expected coverage |
| [`tools/proving-looks.ts`](../tools/proving-looks.ts) | Composed terrain, structures and landmarks |
| [`terrain/proving.test.ts`](../app/renderer/terrain/proving.test.ts) | Crossings, junctions and other world guarantees |

`pnpm proving` regenerates `proving.json` and `proving-judged.json` in
`app/renderer/terrain/fixtures/`. These are generated from the plan and use fixed
judgments so coverage does not depend on a model response.

When adding a form, include it in the plan and regenerate. When changing rivers,
trails or placement, inspect the resulting crossings: paths or banks can move
away from the feature the plan is intended to exercise. The generator checks
coverage before writing.

## Synthetic source for engine checks

`pnpm proving --code DIR` writes actual source with faults corresponding to the
planned health. It also writes a `DIR-manifest.json` describing those faults;
`--manifest PATH` selects another manifest location.

Healthy files have focused steps, useful names and passing tests. Poor files
include hidden state, unrelated helpers, misleading docs, swallowed errors and
failing tests. These faults are intentional test data. Keep generated source
outside Gaia's checkout or under `node_modules` so Gaia does not analyze it as
part of its own world. The engine benchmark generates it automatically.
