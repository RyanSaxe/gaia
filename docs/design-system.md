# World design system

Every rule that makes Jev's components look like one world. Primitives use
these tokens and never define their own colors, shaders or sizes. Jev chooses
among the options by their descriptions and never writes a color or a number.

## Principles

- **Painterly light.** Soft cel shading in a few bands, shadows tinted and
  never black, and aerial perspective instead of a fog wall.
- **One material family.** Every component uses the same plant shader, which
  applies cel light, wind, shadow and the vitality channels. A primitive picks
  a swatch and writes channels, and never ships GLSL. Water and sky keep their
  own shaders.
- **v1's components and Breath of the Wild are the visual bar.** A new
  primitive starts from the v1 equivalent where one existed.
- **Subtle effects.** Glow, saturation and motion stay below what draws the eye
  on its own.

## Color

Color works at three levels:

1. **The world** sets light, sky, season and wind for everything.
2. **Each region's biome** sets its ground cover, wildflowers, air, drifting
   accents and the palette families native to it. Ground colors blend across
   region edges.
3. **Each component** has one palette family. Components never blend.

There are eight palette families in `packages/primitives/src/palettes.ts`
(spring-meadow, deep-forest, teal-gold, autumn-ember, cherry-blossom,
silver-birch, desert-sage, lantern-dusk). Each gives bark, leaf and bloom
swatches. Every family declines toward the same dry grey-brown, so failing
code reads the same everywhere. A season shifts only healthy colors, keeps
each family's identity, and pushes each shifted color a fixed distance away
from its decline color. The `tint` channel varies hue within one swatch across
a canopy; it never touches decline.

## Scale

World units are meters; a person's eyes are 1.6 m above the ground, and there
is no avatar. Each kind owns a height band, and the size binding moves an
instance within it:

| Kind | Height |
| --- | --- |
| Shrub | up to 2 m |
| Small tree | 3 to 6 m |
| Tall tree | 8 to 16 m |
| House | 5 to 9 m |
| Landmark | 12 to 30 m |

## Terrain

No mountains. Landforms (rolling hills, valley, terraces, basin, dunes,
meadow) are relief primitives in each region's biome, blended into one baked
heightfield that every consumer samples. The bake enforces a relief budget:

| Budget | Value |
| --- | --- |
| Total height range | 24 m |
| Walkable ground | at least 95% under 30° |
| Steepest ground | 40°, only terrace risers and stream banks |
| Tallest steep climb | 3 m |

Water is solved from the ground and cut into it, so it never floats. The
world's edge is a gentle rim, and the world should seem infinite: distant
land should dim into the sky's own color. A person can wade but never goes
under water.

## Composition budgets

| Budget | Starting value |
| --- | --- |
| Routes per region | at most 3, covering at most 5% of its ground |
| Open ground | at least 40% of a region |
| Landmarks | at most 1 per region |
| Tree spacing | at least one crown width between trunks |

Jev decides which dependencies become routes; when it wants more than the
budget allows, the most probable win. The world must never be dominated by
paths.

## Clouds

Fair-weather puffs, towering cumulus, cirrus streaks and low drifting banks.
Cirrus suits only some worlds, and Jev chooses where. Mackerel dapples were
removed.

## Planned for slice 2

Not built yet:

- **Night hours.** Moonlit and deep night, lit by a lantern the person
  carries, moonlight as a floor so the land always reads, and the world's own
  glow from vitality and accents.
- **A horizon that seems infinite.** Fog colored by the sky along each view
  ray, and wild land continuing past the rim at low detail.
- **Grass that never grows out of the ground** at the edge of its radius.
- **Wading** that stops before the person's eyes go under water.
