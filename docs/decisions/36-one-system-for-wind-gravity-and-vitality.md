# One system for wind, gravity and vitality

How things move, hang and decline belongs to the shared layers, never to a
component. A primitive says only what carries each vertex: the joint where
its bough or stem leaves the trunk or the ground (`bough`), the joint where
its twig leaves the bough (`twig`) and the point its piece hangs from
(`pivot`). The system does the rest, the same way for every plant:

- **Wind** is one field, `gustAt` and `swayAt` in `@gaia/realize` with
  their GLSL twin `WIND_GLSL` in `@gaia/render`. Gusts travel downwind
  across the land as soft bands, so a gust that bows the grass reaches the
  trees standing in it. A plant bends level by level: the whole plant from
  its base, each bough about its joint, each twig about where it leaves
  the bough, each leaf on its stalk, and only in a gust. Every level is a
  bend that keeps each point's distance from its joint, and whatever a
  joint carries moves with it, so nothing slides and nothing parts from
  what holds it. Grass, flowers, bushes, trees and chimney smoke all read
  the same gusts.
- **Gravity**: every leaf, flower and twig is carried by its parent. Trees
  and bushes grow twigs from their limbs and sprays of leaves on the twigs
  (rooted clumps), flowers and berries hang on stalks from the twigs, and
  limbs and twigs never vanish, so a failing plant stands bare. A spray's
  leaves drop in place, one by one, rather than collapsing toward anything.
- **Vitality** flows through the shared channels: droop bends a whole
  bough about its joint, carrying what grows on it, after the wind.

`unsupportedAt` now holds plants to the same rule as ruins, in still air
and in a strong gust, healthy, tired and failing, and the contract test
checks every flora primitive and every great tree that way, within its
triangle budget.

## Why

The reviewer, after round 15: "Right now wind is moving leaves/twigs
without the tree moving at all and no bending so it breaks immersion ...
Components should not have to have custom code, but the system itself
should make sure vitality changes, wind, physics overall of the world are
maintained. this is important because otherwise procedural generation can
cause really bad looking things." And on the rooted clumps: "100% the
right direction ... maybe it should [apply to other tree types]", and
bushes too.

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), round 16.
