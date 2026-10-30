# World design

Gaia should feel like a landscape that happens to represent code. Its visual
reference is the painterly light, readable silhouettes and natural forms of
Breath of the Wild. Code health shows throughout that landscape, and details
about the code appear on paper the person chooses to open.

![Blueprints establish form. Vitality and time animate shared rendering. The world and the paper show the same facts.](images/design-system.svg)

## Shared visual rules

- Use soft bands of light, tinted shadows and atmospheric distance. Shadows
  keep their color at night, and nearby lantern light restores warm surface
  colors.
- Give each component a clear silhouette and physical support. Branches carry
  leaves, walls carry roofs, and fallen pieces settle against their supports
  or the ground.
- Keep effects subtle. Motion, glow and saturation should support the scene
  without competing with the code's visible health.
- Keep detail stable while walking. Streaming, culling, shadow updates and
  transitions to distant forms must not cause visible changes of shape.
- Preserve immersion. World objects do not gain hover outlines, click rings,
  floating labels or status text. The journal, map and compass provide the UI.

## Color and light

Jev chooses one light, sky and wind for each world. For each region it
chooses a landform, ground cover, air, accents and native palette families. A
component uses one family from those available in its region, so buildings and
plants in a region share its colors. The palette's swatches cover foliage,
bark, stone and building parts. Components take every color from these
swatches.

Healthy palettes vary, but all decline toward dry, muted colors. Hue variation
within healthy foliage must not alter the meaning of decline. The map uses the
same health scale in every world, from green through gold and russet to ash.

The hour follows the local clock. Daylight interpolates between lighting keys.
Jev chooses the character of the light, not the time. At night, moonlight
keeps the landscape readable, windows and lanterns stay warm, and emissive
effects stay restrained. Sky and aerial perspective use the same color model,
so distant land meets the horizon without a visible seam.

| Source | Owns |
| --- | --- |
| [`primitives/src/palettes.ts`](../packages/primitives/src/palettes.ts) | Palette families and swatches |
| [`realize/src/day.ts`](../packages/realize/src/day.ts) | Time and lighting interpolation |
| [`render/src/light.ts`](../packages/render/src/light.ts) | Shared lighting, atmosphere and lantern shading |
| [`realize/src/sky.ts`](../packages/realize/src/sky.ts) | Sky reference model |

## Form and composition

Importance controls the sizes a code item can be offered. Jev chooses its form
by character within that set, so a short but important function can be a
large tree. Every code tree, bush, stone, flower group, building or landmark
represents an entity, file or definition. Ground cover fills the spaces
between them, and no decorative tree represents made-up code.

Kinds declare the roles to fill. A building, for example, combines a
footprint, walls, roof, openings, dressing and a feature. Different primitives
can fill the same role. Later design questions include earlier choices, so
windows fit their walls and features fit their site. Jev selects closed
options, and code calculates geometry and positions.

### Foliage and bark

Build full canopies from overlapping sprays and layered leaves on branches.
Never hide a dark ball or body inside a crown, bush or fir frond. Gaps should
reveal twigs, deeper foliage and sky. A crown is as full on a large frame as
on a small one. A leaf mound on a tree's frame grows as many clusters for its
size as one on a bush. Needles hang as fronds along a fir's whorled limbs, and
gather in pine-like tufts at the tips of a broadleaf frame's forking limbs.

Leaf cuts, bark and canopy lighting are shared across components. Leaves look
like individual shapes close up and like coherent masses farther away. Bark
faces outward, and branch joins stay continuous. Root flares meet the ground
instead of ending above it or in sharp spikes.

### Buildings and landmarks

Building massing changes the whole silhouette. Wings, ranges, storeys, roofs
and attachments must fit together without exposed interior walls or roof
gaps. Openings stay accessible. Foundations and terrain pads seat buildings in
the land, and floors cover the ground inside them.

A feature needs a physically suitable site. A waterwheel requires running
water, sits at its own stream's bank, and reaches the water while its house
stays dry. Landmarks stand on prominent, walkable ground and have silhouettes
that stay recognizable through haze.

Two landmarks with identical answers never look identical. Each landmark's
seed picks the proportions a person notices, within the range its answers
allow. The seed sets a rotunda's span, its columns' height, girth and spacing,
its dome's rise and its steps' depth. It sets a tower's girth, taper, stages
and walkways, a mill's body, stage and sails, an arch's opening, the spacing
of standing stones and every limb of a great tree. The ranges of neighboring
answers never overlap. A seeded shallow dome stays lower than any high one,
and six columns stay wider apart than any eight. The seed also chooses the
side a landmark's weather comes from. On that side its columns topple first,
its tower breaks lowest, its stones lean away and its mill's cap tilts. Each
primitive's ranges are in its shape table, such as `ROTUNDA_SHAPE` in
[`rotunda.ts`](../packages/primitives/src/geometry/landmark/rotunda.ts).

Ruin follows structural support. Coverings fail with or before their frames,
and upper masonry cannot outlast the blocks supporting it. Detached pieces
collapse onto a support or the ground. Ivy grows on remaining walls rather
than across holes. Decline should stay legible from a distance.

| Source | Owns |
| --- | --- |
| [`terrain/looks.ts`](../app/renderer/terrain/looks.ts) | Available forms, importance ranges and water choices |
| [`packages/kinds/src`](../packages/kinds/src) | Component roles and stages of composition |
| [`packages/primitives/src`](../packages/primitives/src) | Geometry, closed parameters and palette selection |
| [`terrain/place.ts`](../app/renderer/terrain/place.ts) | Placement in the world |

## Wind, gravity and vitality

Primitives write the channels that shared rendering code uses for motion and
health. Geometry does not depend on the current vitality, so a live health
update changes rendering inputs and never rebuilds the component.

One wind field moves grass, flowers, bushes, trees and smoke. The field sets
direction and gusts, and each plant's joints and stiffness set its response.
A hanging strand bends about its support rather than stretching, and a gust
should never separate leaves from their stems.

Health affects the whole place. Leaves thin and sag, bark greys, buildings
weather and collapse, grass dries and reveals earth, water clouds, and trails
to failing code grow over. The map and journal show the same judgments. Ground
and water blend health across boundaries, so neighboring patches do not meet
at an abrupt seam.

| Source | Owns |
| --- | --- |
| [`schema/src/ports.ts`](../packages/schema/src/ports.ts) | Geometry and vitality channels |
| [`realize/src/sway.ts`](../packages/realize/src/sway.ts) | CPU motion reference and joint behavior |
| [`realize/src/wind-field.ts`](../packages/realize/src/wind-field.ts) | Wind field and gusts |
| [`render/src/plant.ts`](../packages/render/src/plant.ts) | Shared component shading and decline |
| [`terrain/src/vitality.ts`](../packages/terrain/src/vitality.ts) | Ground health and decline |
| [`terrain/vitality.ts`](../app/renderer/terrain/vitality.ts) | Shared ground, grass and water shader rules |

## Terrain, walking and travel

Areas form a continuous landscape. Landforms, covers and air blend across
region boundaries. Rivers follow the terrain, cross area boundaries and join
one another at the surface of the river they meet. Each river runs on until it
meets another river, a pond or the land's edge. A river that crosses a hollow
cuts through its rim rather than ending in it. Ponds stay enclosed. A river
that ends in a pond meets it at the pond's surface and never cuts below its
rim. Trail networks share treads and junctions rather than duplicating paths,
and cross water on bridges or stepping stones. A coverage budget limits trails
so open ground remains.

Walking follows the ground, intact bridge decks and the walkable steps and
floors of landmarks and buildings, such as a rotunda's or the steps up to a
door. Every solid part of a building or landmark stops or deflects a walk
wherever it passes through a person's height above the ground or step under
it ([`piecesShapes`](../packages/terrain/src/solids.ts)), as trunks and rocks
do. Water allows wading and swimming. A broken bridge can stop a walk and send the
person to ford beside it. Grass and understory clear the footprints of
structures, landmarks, rocks and paths. Under every bush, on the land or in
the wild, grass is cleared from about half the bush's outline at the ground
(`SHRUB_CLEARS` in
[`understory.ts`](../app/renderer/terrain/understory.ts)), as grass grows
thin under a real shrub's canopy. The grass round the bush's edge stays tall.
Mushrooms stand at their natural size, so the grass round a drift of them is
only short turf with a ragged edge, which keeps them visible.

The camera stays level, with no head bob, sway or roll. Forward and backward
keys walk. Side keys turn at a constant rate, with a small nudge on a tap.
Backward walking keeps the view facing ahead. Dragging looks around. These
constraints limit unexpected camera motion and avoid turns that accelerate.

Map travel follows a route, taking a direct path when trails would make a long
detour. It goes around deep water and solids. While the journal stays open
during a trip, travel can speed up behind the paper. The book closes after the
destination is ready. A place without a route is reached by a covered jump.

Movement constants live in `GAIT`, `STEER` and `TRAVEL` in
[`gait.ts`](../packages/terrain/src/gait.ts),
[`steer.ts`](../packages/terrain/src/steer.ts) and
[`travel.ts`](../packages/terrain/src/travel.ts). Keep their values in code so
changes do not leave a second specification behind.

## Sound

Field recordings of wind in the grass, the brook, waterwheels, birds,
crickets, footsteps and the journal's paper play under music derived from the
announcement film's storybook score. Nothing is synthesized. Sound follows the
same rule as visual effects. It stays subtle and never draws attention to
itself.

- Levels follow the film's Hush mix, with the music at −21 LUFS and the world
  about 10 dB under it. No looping world recording rises more than 6 dB over
  its level, however near or strong.
- What the person hears depends on where they stand. It follows the gust
  there, the nearest stream and waterwheel by distance and side, the hour's
  dark, the crowns overhead and how far the land around has failed. Birds sing
  by day over healthy land and fall silent where it fails. Failing land makes
  the wind and the footsteps sound drier, and a stopped waterwheel makes no
  sound.
- The music never stops. Strings and harp play under everything. The theme
  plays the first time round and then two times in three. A night layer joins
  at dusk, and the harmony turns minor over failing land.
- The help slip sets the music and world levels separately, each from silent
  up to the Hush mix, and the game saves both. A hidden window makes no sound.

| Source | Owns |
| --- | --- |
| [`sound/hearing.ts`](../app/renderer/sound/hearing.ts) | What is heard where, as levels, sides and tone |
| [`sound/music.ts`](../app/renderer/sound/music.ts) | How the score plays |
| [`sound/levels.ts`](../app/renderer/sound/levels.ts) | The slip's music and world levels |
| [`sound/assets/CREDITS.md`](../app/renderer/sound/assets/CREDITS.md) | Each recording's source and licence |

## Journal and interaction

Clicking or tapping land walks there. Selecting a code object opens its
journal page without moving the person. The journal opens only when
requested. The closed journal sits at the lower left with the minimap on its
cover. The compass at the upper right opens the help slip, which also holds
the sound levels.

The journal shows a code item's name, quality, importance, code and a painting
of it from the world. Scores are percentages. A folder's or file's page leads
with its most important code, and the appendix shows key and weak block
marks. Paths, references and folds link to the corresponding pages or source.

Pages turn like paper, and the book riffles through to a distant page. A
destination page appears only when its text and painting are ready. Tabs and
the ribbon stay attached to the book through turns and opening animations.
Paintings keep their colors under the pointer.

`M` opens the journal map and `/` opens its finder. A map click marks a place,
and a second click on that mark starts travel. The map stays open during the
trip and follows the traveller. A painting can also send the person to its
subject.

| Source | Owns |
| --- | --- |
| [`immersive/view.ts`](../app/renderer/immersive/view.ts) | World selection, journal integration and help |
| [`journal/book.ts`](../app/renderer/journal/book.ts) | Opening, page turns, tabs and ribbon |
| [`journal/pages.ts`](../app/renderer/journal/pages.ts) | Page structure and navigation |
| [`journal/painter.ts`](../app/renderer/journal/painter.ts) | Brushwork from world captures |

## The field sheet

The map, minimap, journal and waiting screen share warm paper, brown ink and
watercolor. Survey capitals label places, and handwritten notes label the
traveller's marks. Vermilion marks the traveller and the travel route. Paper
warms and dims under lantern light at night.

The maps use real terrain heights and river courses. Building, landmark, tree,
bush, stone and flower symbols are drawn from their composed blueprints, with
the same wear as in the world. A fir draws as tiers up its trunk, and a
failing fir as bare whorls. Trees stay legible when the whole sheet is in
view. Stones, bushes and flowers draw at their size on the land, so they
appear as the map zooms in. Color shows health. Outside the code's land,
unwashed paper and survey ink show the wild, which has no code health.

The minimap turns with the person, and larger maps face north. One layout
places all names clear of other names and symbols. The waiting screen uses
that layout and painter to show completed analysis and design work. It never
paints invented progress, and never shows provisional judgments as final
health.

[`map-styles.ts`](../app/renderer/immersive/map-styles.ts) defines shared paper
and map styles. [`marks.ts`](../app/renderer/immersive/marks.ts) draws composed
buildings and landmarks, and
[`plant-marks.ts`](../app/renderer/immersive/plant-marks.ts) draws composed
plants and stones. [`map-names.ts`](../app/renderer/immersive/map-names.ts)
places names, and [`wait/map-wait.ts`](../app/renderer/wait/map-wait.ts) draws
progress.

## Start page and Gaia's mark

The start page shows a map table under the world's light. Cards show saved
paintings of previously visited worlds, with a commit tally when their code
has changed. Choosing a card raises it into the waiting sheet, where the new
map is drawn. The page frees the table's rendering resources once the world
opens.

Gaia's mark combines a G cut through a green page with the lowercase name, its
"ai" in green. The journal uses the same title face without turning arbitrary
letters in project names green.
[`brand/paint.ts`](../app/renderer/brand/paint.ts) and
[`brand/logo.ts`](../app/renderer/brand/logo.ts) build the mark.

## Detail at a distance

A tree switches to its far form when its crown's span on screen shrinks to
its swap size (`FAR.swapPx` in [`woods.ts`](../app/renderer/terrain/woods.ts)).
The far form is baked from the same component and shaders as the full form. The
transition keeps coverage and silhouette, then dissolves fine detail under the
far form. While both draw, the far form's card lies just in front of its full
form. The full form thins by single samples across its coverage, never a whole
pixel at a time, so neither form shows through the other as a stipple. The
view, reflection and shadow passes each choose detail from screen size. Grass
narrows smoothly rather than changing height as the person approaches.

A far form keeps its tree's outline as it shrinks below its swap size. At the
swap size, the card sharpens its edge to match the full form's. It sharpens
less the barer its tree, because a bare tree is mostly twigs finer than a
texel, and a sharp edge would cut them away (`CARD` in
[`far.ts`](../packages/render/src/far.ts)). Below the swap size, each texel
covers more of the plant, and a twig, strand or needle finer than a texel
covers only part of one. The card draws that partial coverage as it is,
without sharpening, so its outer twigs thin with distance as the full form's
do rather than vanish.

A far form declines with its tree. The bake renders the plant healthy and
records how much of each texel it covers at several vitalities down to 0
(`SLICES` in [`far.ts`](../packages/render/src/far.ts)). A copy then covers
only what its tree still has at the copy's vitality, down to vitality 0 for
the poorest code. A piece that is gone by vitality 0 keeps its healthy color
while it shows, rather than darkening. A declining tree's boughs sag about
their joints and leave that healthy outline. The bake therefore also stores a
coarse field of where each point moves when the boughs sag fully
(`droopField`). The card finds where the point under each pixel came from and
reads its views there. Its boughs then sag as far as its tree's do at the
copy's vitality, and a change of vitality changes what it reads without a new
bake.

Do not reduce density abruptly to save frame time. Batch and instance shared
geometry, stream ahead of the person, cache far forms, and keep shadow updates
stable in world space. Far forms have a fixed memory budget. A build without a
far-form slot draws its full form, never a coarser card. A build that gains or
loses a slot moves its swap size over many frames rather than changing a tree
at once. Each slot holds a form's views at every mip level a card reads before
the tree is too small to see, and its droop field (`farSlotBytes`). Use the
[walking and swap probes](development.md#visual-verification) to check that a
performance change preserves the view.
