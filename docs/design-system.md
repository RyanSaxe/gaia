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
   accents and the palette families native to it. Ground covers drift into
   each other across region edges (see Terrain).
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
heightfield that every consumer samples.

A region never shows its shape. Region cells are domain-warped, so their
borders curve and wander, and neighboring landforms ease into each other
across a band 130 m wide. Ground covers blend by the same weights broken into
seeded patches about 30 m across, so one cover drifts into the next in
islands rather than along a gradient. The overview marks the selected region
with a faint glow that follows its cover and fades at its edge; walking shows
nothing. `regionWeights` and `coverWeights` in `@gaia/terrain` are the
references, and the bake keeps each sample's cover weights for the shaders.

The bake enforces a relief budget:

| Budget | Value |
| --- | --- |
| Total height range | 24 m |
| Walkable ground | at least 95% under 30° |
| Steepest ground | 40°, only terrace risers and stream banks |
| Tallest steep climb | 3 m |

Water is solved from the ground and cut into it, so it never floats. The
world's edge is a gentle rim. Past it, one ring of low-detail wild land runs
on to 1.5 km, continuing the rim's height and settling into a gentle roll of
at most 6 m, colored by the nearest region's cover. It is never walkable.

A person can wade but never goes under water. Walking slows as the water
deepens, to 40% of its pace at 1.1 m, and a step that would end where the
water is 1.2 m deep slides along the edge instead; eyes stay 1.6 m above the
ground. `walkStep` and `waterDepthAt` in `@gaia/terrain` are pure, so tests
check every step.

Grass keeps its full height at every distance, so it never grows out of the
ground. Each blade has a seeded threshold and disappears whole once the
viewer is farther than that, thinning from 55% of its reach of 60 m; a
quarter of the blades reach only 14 m and a third only 30 m, so grass is
densest close by. Blades thin the same way, whole, on steep risers and over
the sand banks within one to three meters of water, which the ground paints
from the same shore distance. The ground beneath is painted in the cover's
own colors with short dabs in three directions, so where blades thin out the
ground still reads as the same cover and no stroke runs on into a streak.

Each cover sets its blades' form: how far they lean, how round their outline
is (a pointed blade or a round leaf) and how far they arc over. Lush grass is
soft arcing blades with blunt tips; heather is splayed sprigs with purple
tops in bushy tufts; moss and clover are low round leaves. Blades bend as
arcs that keep their length. The wind rolls across the field in broad, soft
gusts that bow the blades and show their paler sheen.

## Sky and distance

The world should seem infinite, so the horizon never shows a line. One sky
function, `skyColor(dir)` in the shared light chunk, colors both the dome and
the air: the dome draws it and adds clouds, the sun, the moon and stars on
top, and `aerial()` hazes every surface toward it along the same view ray.
Near and middle distance take the local air's tint, lit by the sky behind
it; farther, only the sky's own color remains, and land fully dissolves
between 900 m and 1.4 km. Rays that skim the land pass through the most air,
so far ground just below the horizon thickens into the sky over a band, not
at a line. Dome
clouds thin out toward the horizon rather than stopping, and clouds standing
on the horizon rise out of its haze. `skyColorAt` and `aerialAt` in
`@gaia/realize` are the CPU references the tests check.

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
Cirrus suits only some worlds, and Jev chooses where; it is thin and high,
fine streaks nine times longer than wide, faint, and kept to the upper sky. Mackerel dapples were
removed.

## Day and night

A world's hour follows the person's own clock. Jev chooses how each world's
light looks (the sun's path, its warmth, the brush, the moon and the stars)
but never the hour. `daylight@1` lights eight keys: dawn 6:00, morning 8:30,
midday 12:30, afternoon 15:30, golden hour 18:00, dusk 19:30, moonlit 22:00
and deep night 2:00. Between keys, colors mix in OKLab and the sun and moon
turn at a constant rate; a body below the horizon lends no direct light.

Night follows four rules, all in the shared light chunk so plants, ground,
grass and water agree:

- **Moonlight is a floor.** Night ambient and shadow colors are cool blue,
  never black, and hues fade halfway toward a cool grey under the moon, so
  the land reads as blue shapes while warm palettes stay warm. The moon is a dim soft-cel key, and it casts
  the shadows once the sun has set.
- **The lantern.** The person carries a candle-orange lantern at hand height,
  a little ahead and to the right. Its pool is about 12 m across and fades
  smoothly to nothing, with no edge; colors come back inside it. It lights
  surfaces only, never the air. It fades in through dusk, sways a few
  centimeters with each stride and settles when the person stops. The Flora
  tab carries none, so plants are judged under the moon alone.
- **The night sky** deepens to blue, keeping a trace of the world's own sky
  color. The chosen moon, the chosen stars, and clouds silvered by the moon.
  A river of stars is a band: a milky glow with a brighter core, split by a
  dark lane of dust.
- **The world's own glow** (the vitality `glow` channel, fireflies, living
  water) reads by contrast in the dark, a little stronger than by day and
  still below what draws the eye on its own. Wildflowers fade into their
  blades at night.
