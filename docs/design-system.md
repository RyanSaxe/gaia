# World design system

Every rule that makes Jev's components look like one world. Primitives use
these tokens and never define their own colors, shaders or sizes. Jev chooses
among the options by their descriptions and never writes a color or a number.

## Principles

- **Painterly light.** Soft cel shading in a few bands, shadows tinted and
  never black, and aerial perspective instead of a fog wall.
- **One material family.** Every component uses the same plant shader, which
  applies cel light, the world's one wind, shadow and the vitality channels. A primitive picks
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

There are nine palette families in `packages/primitives/src/palettes.ts`
(spring-meadow, deep-forest, teal-gold, autumn-ember, cherry-blossom,
silver-birch, desert-sage, lantern-dusk, bluebell-wood). Each gives bark, leaf
and bloom swatches; for the ground, a stone, the moss that grows on it, and a
wildflower's stem and eye; and a building's wall, timber, roof, masonry, trim,
window-glass and smoke swatches, so a family's cottages belong with its
plants. Every family declines toward the same dry grey-brown, so failing
code reads the same everywhere. A season shifts only healthy colors, keeps
each family's identity, and pushes each shifted color a fixed distance away
from its decline color. The `tint` channel varies hue within one swatch across
a canopy; it never touches decline.

## Leaves

Canopies are painted masses from afar and leaves up close, and every leaf
is carried by something. A broadleaf's crown is clumps where its mass is,
one at every limb tip and, for a full crown, more along the inner limbs, so
from afar it reads as the same rounded mass. Each clump is a fan of thin
twigs that leave the limb along its last stretch and curve out to the
clump's surface, with sprays along them: a spray is a stalk with leaves on
short stalks alternating along it, its base on its twig. No ball sits
inside a crown, so up close the gaps show twigs, deeper sprays and sky.
Each family has its own spray (`leaf-clumps@1`'s `leaf`): pointed, oval
(an apple's), lobed (a maple's), or blossom, umbels of five-petaled flowers
on fine stalks, their petals the family's pale bloom deepening to its leaf
color at the heart, with a few small leaves in the family's stem green (a
cherry's). A spray's stalks are the bark's color. A primitive only places
cards and names their cut (`CUT` in `@gaia/schema`: cluster, oval, lobed
and umbels are sprays; strand, needles, patch and core); the
plant shader cuts each card to its leaves, with no textures. Every card
shades with the crown's blended normal, so the canopy lights as one
volume, and sprays deep in a clump shade darker. As a spray shrinks on
screen its leaves merge into a soft scalloped round, so distant canopies
are painted masses that never sparkle. A card turning edge-on thins its
leaves from their edges until nothing is left. Cards cast their outlines
as shadows, so sun falls through between them.

Willow strands are crossed ribbons of small hanging lance leaves, hung from
the tips and the undersides of the limbs, each topped by two small sprays;
far off a strand swells and narrows along its length, as its leaves bunch,
so a curtain never reads as ribbons. A fir spray is a frond along its
limb: a ridge of needles along the limb and branchlets to either side that
reach toward the tip and droop, so a fir reads as layered, feathery
needles rather than flat plates. No crown, bush or frond has a dark body
inside it to read as dense: its fullness comes from its leaves.

Bushes are built the same way as a crown: twigs from every stem carry
sprays of leaves out to the mound's surface, down to the soil, and the
mound shades as one volume, bright on top and at the rim, darker inside,
where the stems show in its shade. Their blossoms are umbels on stalks
from the twigs, and berries hang in small clusters on stalks.

Bark faces outward and draws front faces only. A trunk is one tube from the
ground to its fork, and each bough one tube from its joint to its tip, so
the bark's ridges run unbroken past the joins. Where a trunk meets the
ground it flares into three to five broad root lobes that sink into the
soil, each sized and turned a little differently, curving in to the trunk
within about two of its widths.

### Wind, gravity and vitality

One system moves, holds up and declines everything that grows, so no
component writes its own (`docs/decisions/33`). A primitive says what
carries each vertex: the joint where its bough or stem leaves the trunk or
the ground (the `bough` channel), the joint where its twig leaves the
bough (`twig`) and the point its piece hangs from (`pivot`).

- **Wind.** One field for the whole world, and each plant's answer to it.
  The field is `gustAt`, `windDirAt` and `WIND_FIELD` (`wind-field.ts`
  in `@gaia/realize`, `WIND_FIELD_GLSL` in `@gaia/render`, which a test
  runs against them); the answer is `swayAt` and the levels of `WIND`
  (`sway.ts` in each, `SWAY_GLSL` in `@gaia/render`). The air is mostly a
  light breeze that swells and eases over tens of seconds, its direction
  wandering a few degrees. Gusts come irregularly: at any spot one passes
  every 8 to 40 seconds, most often about ten, most of them mild, and a
  strong one every minute or two. Each is a soft front that rises in about
  two seconds and eases over four, travelling downwind at 6 m/s, bowed by
  a slow meander and stronger in some places along it than others, so a
  gust rolls through the grass and on into the trees while the land
  beside it stays calm.
  A plant bends level by level: the whole plant from its base by height,
  each bough about its joint, each twig about where it leaves the bough,
  and each leaf or flower on its stalk, only in a gust. Each level leans
  downwind with the gust where its joint stands and swings gently about
  that lean, smaller parts faster, each with its own phase; both grow with
  the square of the gust (`WIND.answer`), so the steady breeze only stirs
  a plant and a strong gust bows it. Every level
  turns about one axis per joint, so whatever a joint carries turns as
  one: a broad leaf, a round stem and a bell keep their shape, and a bough
  curves and never slides. A turn grows smoothly from its joint and eases
  toward a most it never passes, so the gustiest world folds nothing into
  a crease. Past where its turn holds, a long hanging piece swings less
  and trails, so a willow's strands sway rather than whip. A taller plant
  is thicker, so its trunk and boughs lean less (`WIND.build`), and a
  fir's needles are too stiff to flutter (`STIFF`). Grass, flowers,
  bushes, trees and smoke read the same gusts. A plant's `sway@1` sets how
  far it gives and how quickly it swings; calm is the default.
- **Gravity.** Every leaf, flower and twig is carried by its parent: a
  spray's base sits on its twig, a twig grows out of its limb, flowers and
  berries hang on stalks from twigs, a strand hangs from a limb's
  underside. Limbs and twigs never vanish, so a failing plant stands bare,
  and a weeping limb levels out above the ground rather than into it.
- **Vitality.** A spray's leaves brown and drop in place one by one,
  around the spray's own threshold, eroding from their edges; nothing
  shrinks toward anything far away. Droop bends a whole bough down about
  its joint, after the wind, carrying all it bears.

`unsupportedAt` holds plants to the rule ruins keep: the contract test
builds every crown on frames of every kind with bark and blossoms, and
every great tree, healthy, tired and failing (1, 0.5, 0.15), in still air
and in a gusty world's strongest gust, and finds nothing floating, within
40,000 triangles a plant (50,000 for a great tree). In that gust every
plant, great tree and drift of wildflowers also keeps its shape: no
triangle's edge stretches or shrinks by more than a quarter, and none
turns over.

## Scale

World units are meters; a person's eyes are 1.6 m above the ground, and there
is no avatar. Each kind owns a height band, and the size binding moves an
instance within it:

| Kind | Height |
| --- | --- |
| Wildflowers | 0.3 to 1 m, heads just above the grass |
| Rock | 0.5 to 2.2 m; a ledge runs up to 11 m |
| Shrub | up to 2 m |
| Small tree | 3 to 6 m |
| Tall tree | 8 to 16 m |
| Building | 5 to 9 m a storey or two; up to 14 m with three storeys or a turret |
| Tower | 8 to 19 m, taller with more depending on it |
| Landmark | 12 to 30 m; great stones 3 to 8 m, set out 10 to 25 m across |

## Terrain

No mountains. Landforms (rolling hills, valley, terraces, basin, dunes,
meadow) are relief primitives in each region's biome, blended into one baked
heightfield that every consumer samples. A full world is 1.2 km across with
18 to 22 regions; the tests also bake small worlds, 320 m with 3 to 5.

A region never shows its shape. Region cells are domain-warped, so their
borders curve and wander, and neighboring landforms ease into each other
across a band 130 m wide. Ground covers blend by the same weights broken into
seeded patches about 30 m across, so one cover drifts into the next in
islands rather than along a gradient. The overview marks the selected region
with a faint glow that follows its cover and fades at its edge; walking shows
nothing. `regionWeights` and `coverWeights` in `@gaia/terrain` are the
references, and the bake keeps each sample's four largest cover shares for
the shaders, which interpolate them between samples as the lattice does.

The ground near the person is drawn as five nested rings that follow them,
from 1 m quads out to 16 m quads, each reaching twice as far as the one
inside it. Every ring's vertices are lattice samples, a coarser ring's a
subset of the finer one's, and toward its outer edge each ring morphs, by
distance, into exactly the next ring's surface, so rings meet without a
seam and the ground never changes shape perceptibly as the person walks.
Grass only grows on the finest ring, where the ground is the lattice itself.

The bake enforces a relief budget:

| Budget | Value |
| --- | --- |
| Total height range | 24 m |
| Walkable ground | at least 95% under 30° |
| Steepest ground | 40°, only terrace risers and stream banks |
| Tallest steep climb | 3 m |

Water is solved from the ground and cut into it, so it never floats. The
world's edge is a gentle rim.

Past the baked land the wild land goes on forever and stands for nothing.
From the rim's crest it settles over 160 m to the level of the land inside
the rim, into a gentle roll of at most 6 m, which swells between 200 m and a
kilometer out into soft hills of at most 18 m from trough to crest. A person
can walk or tap their way off the land in any direction and keep going, with
no wall anywhere. The rings around the person draw the wild land from the
same function the walk stands on (`groundHeightAt` in `@gaia/terrain`, whose
integer-hash noise has a GLSL twin), so it follows them; a coarse ring of it
surrounds the world for the overview and the water's mirror. The wild grows
its own two covers, tall unkempt green grass and tall dry golden grass,
which drift in from the land's covers in islands past the rim and mingle
blade by blade in broad swathes. Low brush darkens the ground in dabs that
crowd together where the wild runs to scrub, and wild bushes stand in
seeded thickets there, always healthy. The covers and the thickets are
`@gaia/terrain`'s (`wildShare`, `wildPatch`, `wildScrub`, `wildThicket`),
which the field sheet inks too. Only the thickets within 1.64 km of
an anchor that jumps to the person every 200 m stand, so every bush that
comes or goes is past where land has fully dissolved into the sky.

Water never stops a person, and they never go under. Walking slows as the
water deepens, to 40% of its pace at 1.1 m; deeper, the feet leave the
bottom by 1.5 m and the person swims at 30% of the pace. Eyes stay 1.6 m
above the ground until the water nears them, then ease down as the bottom
falls away until they float 0.3 m above the surface, and rise again the same
way climbing out: the eye height is a smooth function of depth, so it never
jumps. A swimmer bobs gently, 3 cm every 2.8 s, and the wading rings go on.
At night a swimmer holds the lantern just above the water.

Solid things stop a person: tree trunks at the bark of their base, rocks and
bushes by their outlines at the ground (all of a rock; the heart of a bush,
so the walk brushes its outer leaves), and a house's walls. A stone lower
than half a meter is stepped over, and drifts of flowers are walked through.
Each solid is the convex hull of its outline, so a step that would end in one
slides along its edge without catching: pushing straight at a trunk stops,
pushing at an angle slides around it. The body keeps 0.4 m from every edge.
`walkStep`, `stanceAt` and `solidsOf` in `@gaia/terrain` are pure, so tests
check every step.

A person walks by tapping or clicking the ground, the same with a mouse, a
trackpad or a thumb, and drags to look. The walk plans its way around
whatever stands between (straight when nothing does), follows it at 4.2 m/s,
jogs at 1.8 times that while more than 25 m remain, easing back to a walk by
15 m, slows as if braking to arrive, and ends within 1.5 m of the spot, so a
tap that close to where the person stands stops them. It heads for a point
1.2 m ahead along its way, so it rounds each corner in a curve. A tap across
a pond swims all the way across. A tap on a rock or a bush walks up to the
face that was tapped; when solids ring the spot, the walk ends at the
nearest place it can reach. The view never turns on its own. Nothing marks
where a walk will end: touching the world just walks. `planWalk` and
`wayAhead` in `@gaia/terrain` plan the way and say where to head next.

A person walks like a person, not a sliding camera (`stride` in
`@gaia/terrain`, every parameter in its `GAIT` table). The body eases into a
stride over about a second, two steps, and settles over about 0.7 s when it
stops, so velocity never jumps; the arrow keys ease into and out of a turn.
The grade along the way sets the pace by Tobler's hiking function made
gentler: a 12% climb walks at about 79% of the pace, a descent of up to 16%
is a little quicker (at most 10%), and a steep descent is careful; no grade
slows a person below 35%. The eyes ride 1.6 m over the mean footing within
half a meter, which smooths away the lattice's facets, on a critically
damped spring read ahead of the body by the spring's own lag, so on a slope
they keep their height within 3 cm and never overshoot or float. A
footbridge's deck is ground to walk on: stepping up onto it lifts the eyes
as a step, and the person crosses dry above the water. Each step lifts the
eyes about a centimeter (1.1 cm at a walk, 1.8 cm running with Shift, half
the rise and fall) at 1.9 steps a second (2.6 running, a longer stride),
lowest as a foot falls; they sway 6 mm from side to side once every two
steps. The stride only translates the eyes: it never rolls or pitches the
view, so distant land holds still. It fades in and out with speed, wading
softens it by up to 65%, and a swimmer bobs gently instead. `GAIT.on`
switches the stride off and keeps the rest.

These numbers follow the research on walking and comfort. A walking head
rises and falls once each step at about 2 Hz and sways once each stride at
about 1 Hz (Hirasaki et al. 1999, "Effects of walking velocity on vertical
head and body movements during locomotion", Exp Brain Res 127); camera
oscillations of that kind make desktop walking feel like walking (Lécuyer
et al. 2006, IEEE VR; Terziman et al. 2013, IEEE TVCG 19(4), which also
slows the walk on slopes). Motion sickness peaks for vertical motion between
0.1 and 0.5 Hz (ISO 2631-1) and for visual motion at 0.2 to 0.4 Hz (Diels
and Howarth 2013, Human Factors 55(3)), so the stride stays above that band
at 1.4 to 2.6 Hz, its sway at about 1 Hz, and the eyes' motion carries
nothing above 4 Hz. The rise is kept well under a real head's few centimeters, since a
screen cannot steady the gaze as the eyes' reflexes do, and the switch
follows the Game Accessibility Guidelines and Xbox Accessibility Guideline
117. Tobler's function is from Tobler 1993; a person reaches a steady pace in
two or three steps (Najafi et al. 2010, Gait & Posture 32(1)) and can stop
in one.

Streams run downstream along the flow solved from their bed (`streamFlow`
and `flowAt` in `@gaia/terrain`), faster where the channel narrows or the
waterline falls. Ponds lie still, and now and then a ring spreads across one.
Looking down, water is clear: the bed shows where it is shallow, and the
water's own teal deepens with depth. At a grazing angle it mirrors the sky,
the banks and the trees, softened and broken by the ripples. A soft line of
foam marks the shore. Rings spread from the person's legs while they wade,
and the water settles when they stop. At night the moon lays a sparkling
path, the lantern a warm glint close by, and living water carries faint
drifting specks of light. Water is as alive as the area it flows through
(see Vitality on the land).

Grass keeps its full height at every distance, so it never grows out of the
ground, and no blade appears or vanishes as the person walks. Each blade
stands at a fixed spot on the ground and narrows smoothly to nothing across
its own seeded band of distance: the band starts between 50% and 80% of the
blade's reach and runs a fifth of the reach, so a half-meter step changes a
blade's width by at most 27%, and a frame of walking by at most 4%. Of the
blades, a quarter reach only 14 m and a third only 30 m, the rest 60 m, so
grass is densest close by. On steep risers and over the sand banks within
one to three meters of water blades thin whole, chosen by their spot on the
ground rather than by distance, so walking never changes which of them
stand; the ground paints the banks from the same shore distance. The ground
beneath is painted in the cover's own colors with short dabs in three
directions, so where blades thin out the ground still reads as the same
cover and no stroke runs on into a streak. Where the ground declines, blades
thin, shorten and turn to straw (see Vitality on the land).

Each cover sets its blades' form: how far they lean, how round their outline
is (a pointed blade or a round leaf) and how far they arc over. Lush grass is
soft arcing blades with blunt tips; heather is splayed sprigs with purple
tops in bushy tufts; moss and clover are low round leaves. Blades bend as
arcs that keep their length. The world's one wind rolls across the field in
broad, soft gusts that bow the blades and show their paler sheen, and the
same gusts reach the trees and bushes (see Leaves).

### Vitality on the land

The ground takes the vitality of whatever it belongs to, as the trees do: a
file's patch its file's, an area's own ground (its lots) its area's, every
file under the area pooled by size (`areaVitality`), and the wild past the
land always thrives. A failing grove in a healthy area is one sick patch in a
living place, and a ruined area is ruin all through. One patch's health eases
into its neighbor's over about 7 m, wider where the land's warp gathers the
ground and narrower where it spreads it, and the land hands its ground to the
wild over 8 m at its rim, so no border shows as a line.

Ground of vitality 0.85 or more looks as it always did; below that it
declines, all it will by about 0.02:

| Vitality | Grass | Ground | Water |
| --- | --- | --- | --- |
| 0.85 and up | As it always was | Its cover's own colors | Clear and lively |
| 0.5, tired | 83% of blades stand, a tenth shorter, and a third have turned to straw | A third of the way to straw | Clouding |
| 0.1 and below, failing to ruin | 56% stand, three quarters as tall, nearly all straw | Dried to straw, with bare earth open over two fifths of it | A still brown murk that hides its bed |

Blades thin one by one, each at its own seeded point, narrowing to nothing by
the same rule as distance, so no blade pops as vitality changes. None stands
on bare earth, and blades give out across a wider edge than the earth's, so
a bare patch opens in the grass rather than behind a wall of it. Each blade
turns to straw at its own point, gold or for some a withered grey-brown, so
a failing field is a mottle of straw and the last green, and a flower fades
with its blade. The ground's cover dries toward straw dab by dab, and bare
earth opens in patches a few meters across, painted in the same short dabs in
the earth's own warm tone. Water reads its area over about 15 m, so a stream
clouds and clears gradually as it passes from one area into the next;
failing water hides its bed in a brown murk, its ripples and streaks still,
and its sparkle, foam and night specks dim. `groundDecline` and `groundLook`
in `@gaia/terrain` are the rule, and the grass, ground and water shaders
follow it (`VITALITY_GLSL` in `app/renderer/terrain/vitality.ts`).

## Sky and distance

The world should seem infinite, so the horizon never shows a line. One sky
function, `skyColor(dir)` in the shared light chunk, colors both the dome and
the air: the dome draws it and adds clouds, the sun, the moon and stars on
top, and `aerial()` hazes every surface toward it along the same view ray.
Near and middle distance take the local air's tint, lit by the sky behind
it; farther, only the sky's own color remains, and land fully dissolves
between 900 m and 1.4 km. Rays that skim the land pass through the most air,
so far ground just below the horizon thickens into the sky over a band, not
at a line. Low mist
rises from the land into the lowest sky and thins upward, veiling even a low
sun's haze, so misty ground meets a dawn sky in a soft band. Dome
clouds thin out toward the horizon rather than stopping, and clouds standing
on the horizon rise out of its haze. `skyColorAt` and `aerialAt` in
`@gaia/realize` are the CPU references the tests check.

## Buildings

A building stands for an entity. Buildings are as flexible as trees: a few
strong axes of `cottage-plan@1` change the whole form, and walls, roofs and
openings compose on whatever it lays out, so one set of primitives makes a
hamlet of very different buildings.

| Axis | Choices |
| --- | --- |
| Massing | a single block; an L (a wing juts out at one end, its gable looking outward); a T (a gabled wing from the middle); a long range (blocks in line, each narrower); a cluster (wings and outbuildings joined all round) |
| Main body | long, snug or gable-fronted; tiny to roomy |
| Storeys | one to three, and whether joined parts keep one eave line or step down a storey each |
| Roof form | gabled, hipped or half-hipped over the body and its wings; a lean-to's one slope; a turret's cone |
| Attachments | a gabled porch over the door, a lean-to shed, a round turret a storey taller |
| Character | how steep the roofs, how high the plinth, how many windows, how settled and crooked |

Each volume is a mass: walls standing on a rectangle (or a turret's
octagon) under a roof of its own. Joined masses overlap where they meet, so
a wall inside another mass is never built and a wing's roof runs into the
main roof in a valley. Every wall rises to the roofline over it, so gables,
hipped ends, a half-hip's cut-back gable and a lean-to's slope meet their
roofs exactly. A hipped range hips only the ends no other mass joins, so a
long range reads as one stepped roof. Windows fall where walls show, in
every storey, clear of the door, the chimney's gable and each other; a big
building keeps those that look toward the walk, at most fourteen. Its walls
keep within 9,800 triangles and its roofs share 4,300 across their slopes:
fine work (studs, plaster cells, plinth stones, ivy, tile courses) coarsens on
a big building and again until it fits, so a building of many masses keeps
its budget by construction.

A building stands on a pad leveled into
the baked ground under it and its yard, blending back into the land over
7 m, and its foundation reaches 1.4 m below, so it never floats and never
shows a gap. Grass is cleared under the house and along the walk to its
door, and its walls stop the walk. A building stays under 32,000 triangles
and draws one mesh per swatch, at most eleven calls.

A feature sets a building apart and says what its entity does, on the side
the chimney leaves free. A mill's waterwheel turns in a stone-lined pit, fed
by a flume on trestles or pushed round by the race, about once every nine
seconds; it slows as vitality falls and stands still below 0.1. An
archive's tower rises from the back corner, rendered between stone quoins,
taller the more of the code depends on it, its narrow windows lamplit at
night under a steep cap or an open lantern room whose lamp burns after dusk.

A failing building falls to ruin, and reads from 40 m. It gives way first
at the front corner away from the door, where a person walking up sees it:

| Vitality | What shows |
| --- | --- |
| 1 | Whole and lived in: lit windows, smoke, flowers |
| 0.5 | Tired: plaster falls in patches, the first holes in the roof's eaves, ivy at the corners, the door ajar, a shutter hanging, long grass |
| 0.2 | Failing: the roof rotted through over bare rafters, walls holed and timbers fallen at the weak corner, rubble below, windows broken or boarded, the chimney toppling, the flower boxes down |
| 0.05 | A ruin: most of the covering gone, the chimney lying across the ridge, ivy to the eaves, rank grass and rubble all round, a tower's top and lantern fallen |

Ruin follows each form: every mass's walls and roof rot by the same weak
corner, a lean-to's whole slope caves in about its high edge, a turret's
cone rots through and its finial leans and falls, and a fallen timber is
one storey's post, so a tall house collapses floor by floor.

Ruin obeys gravity. Every piece knows what holds it up and goes no later
than it: plaster before the timbers framing it, a rail before the pickets
it is nailed to, a trough before the trestles under it, a quoin before
the one below. A piece that goes shrinks back onto what holds it (a
timber onto the post it is pegged to, a pane onto its sill, a board onto
the frame it is nailed to), so nothing hangs in the air even partway
through. What falls comes to rest: a toppled post lies with its head on
the ground, a chimney lies along the ridge, a finial lies down its roof,
and a flower box pitches off the wall and is gone. Ivy grows only where
there is wall to hold it, never past its top.

Every one of these is a vitality channel on the pieces the primitives
already build, so nothing is rebuilt and nothing pops. Ivy and the moss on
a ruin keep the family's moss green: nature takes a ruin back, rather than
everything turning grey.

## Signs and cards

Everything that stands for code says so in the world. A building has a
wooden signboard on a post at the end of its walk, facing anyone coming up
it, with its entity's name and what it is painted on; a tree has a small
plaque on a stake at its foot with its file's name. Signs are always there:
a name becomes readable as a person comes near, as a real sign's does, and
the lantern lights it at night. Nothing fades in or appears. Every name
fits its board, never cut off: it is set on one line as large as the board
allows; a name too long for that breaks onto two lines where a person would
break it (after a slash, a dash, a dot or an underscore, between words, or
where a camel-cased word turns); then the board widens, up to half again,
with the cross-arm it hangs from; and only then do the letters shrink
(`app/renderer/terrain/lettering.ts`). A sign follows
the vitality of what it names: its paint fades and flakes, its wood greys
and it leans on its post. All signs draw as one instanced mesh.

Tapping a building, a tree, a sign, or the stone, bush or flowers a
function or class stands as walks the person up to it (to the end of a
building's walk, just outside a tree's crown, or a couple of steps from a
function's stone on their side), and
when they arrive the view turns gently, in about a second, to frame the
thing. A low thing, such as a function's stone or bush, is framed by its
own middle, looking down at it at the person's feet. A thing already close
counts as arrived. A new tap or a key cancels the walk and nothing opens.

In the immersive world, walking up to a thing, the minimap rings it, and
on arrival its page rises at the lower left (see The field sheet).
Stopping at a thing without tapping it raises its page too: every thing
that stands for code has one, a building, a landmark, a file's tree, and
the stone, bush or flowers a function, class, constant or type stands as.
The person has stopped at a thing when they stand still no farther from
it than walking up would bring them, and 2 m more, with it near the
middle of their view; of several, the one nearest the middle. A building's
or landmark's page rises after 0.6 s of standing, anything smaller's after
1.5 s, so walking through a grove or past a drift of flowers raises none,
and a pause shorter than that raises nothing (`STOP_AT` in the terrain
lab). A file's trees all raise the file's one page. The page belongs to its
thing: walking more than 4 m from where it opened lets it go, and so does
Esc, after which standing there raises nothing until the person moves on.

In the Terrain view the thing's card opens in the panel or the sheet
instead, and reads like a page from a field guide: what kind of thing it
is, its name, what it does, where it lives in the code, its size, what it
leans on and what leans on it, what it stands as in the world, who judged
that (Jev, or the stand-in when Jev did not answer), and its vitality in
words (thriving, healthy, tired, failing, in ruins) with the signals behind
it, each with its reading. Walking away, its × and Esc close it.

While a codebase's world opens, the wait covers the screen
(`app/renderer/wait/`). It shows no words, counts or percentages and never
names Jev or OpenRouter: the progress a person sees is the world coming to
be: the map paints itself, on the field sheet (see The field sheet). The field map's own sheet lies on its creased
paper: the same size, paper, torn edge, turned-down corner and shadow.
While the code is read, light drifts over the empty sheet: leaves' light
by day, the lantern's pool breathing at night. As soon as the land is
divided, a pen draws every area's border, from the middle outward, in the
green of the map's hedgerows, and never the land's rounded rim; a fringe of
wood is brushed in along the sheet's edges as the map paints it. Each
area's wash runs on past the rim to the paper's edge wherever it is the
nearest area, so the land fills the sheet square, as on the map. While Jev is asked, a round
watercolor brush is held over the sheet with its shadow: it goes to an
area with a question out, touches down, its shadow meeting its tip,
leaves a damp dab that dries, hovers and moves on, brisk while answers
flow and about half as quick in a lull, never still and never saying how
much is left; the areas with a question out take a pass of clear water
first, the paper darkening a touch under a slow sheen, so even a long lull
shows the map being drawn. By day the brush's shadow falls from the
window, at night from the lantern (`brush.ts`). Each area washes in as its
judgments settle, in the color of the land Jev judged for it, as the map
washes it: coming in wet, a little darker, and spreading from its heart;
while the world bakes the washes dry lighter and into their land's health,
as the map's wilt (tired land toward straw, thriving land a touch richer).
An area whose land is not judged yet stays bare paper inside its border.
Then the map folds away as the field map does and the paper dissolves into
the world, as a jump on the map does, and the place's name is written on
the minimap. The sheet has no title, names or marks. After dark it is read by the lantern, warm at its middle and
falling into blue at its edges.

Everything in the wait that moves is an opacity or transform animation, or
a pen line's dash, so it keeps moving while the page stands the world, and
the world shows only after its first frames have drawn under the wait. When
judging would cost more than the person's spend limit, a small slip of warm
paper at the foot of the wait says what it costs against the limit and
that without it the world is drawn from the code alone, with two answers:
Go ahead, in moss green, and Not for this world, in ink, which the project
remembers until the limit changes. The world appears only once it is fully
judged.

## The start

When Gaia opens with no world named, the start lies over the wait
(`app/renderer/start/`), in its veil, so it follows the same hour and, once
a place is chosen, dissolves into the wait's paper. It offers the worlds a
person walked before, a folder on this computer, and a line to write the
address of a place on GitHub. Nothing on it is a box or a word of jargon:
no "repository", "clone" or "Jev". An address that leads nowhere is
answered beneath it in a sentence in the world's voice ("Nothing open lies
at that address. It may be private, or spelled a little differently."), the
written address fading a little while the line or arm settles. While an
address is asked after, ink runs along its line, or its arm creaks. Two
directions are built, chosen by `CHOSEN_START` in `start.ts` or
`?start=table|signpost` (a standalone page shows it only when asked, with
Gaia's own world as the one walked before):

- **The traveller's map table** (shown): the field map's paper on a dark
  wooden table, with Gaia's mark lettered at its corner. Each world walked
  before is a small map sheet laid on the paper a little askew, its areas
  washed in their lands' colors with water, cottages and landmarks inked
  small, its name lettered beneath in italic and where it lies in small
  capitals. At the paper's foot an ink line waits for an address, with "or
  open a folder on this computer" beneath it. Choosing lifts a sheet; then
  the table falls away and the paper fills the view as the wait's. After
  dark the lantern lights the table.
- **The world's edge**: standing where the land begins, at the hour it is,
  by a wooden signpost like the fingerposts in the world. Its arms are
  painted with the worlds walked before; one points "somewhere on this
  computer"; one is bare wood to write an address on. Hills fall away into
  haze behind it and a path sets out; after dark the stars are out, the
  post's lantern is lit and a few fireflies drift.

## One way to touch the world

A person never has to think about what a touch will do. Mouse, trackpad,
finger and keys all follow the same three rules.

- **The world moves you.** A tap or click on the world always means "go
  there". On the land, the person walks to the spot (a tap where they stand
  stops them). On a thing (a building, a tree, a landmark or its sign) they
  walk up to it, the view turns to frame it, and its page rises. A
  tap on a rock, a bush, a fingerpost or a boundary stone walks up to it, never to
  the ground hidden behind it. A drag looks around and never walks. W A S D
  or the arrows walk and Shift hurries. A drag or a key takes the view back
  from a turn at once. Touching the world never does anything but move you.
- **Everything else is paper.** The minimap at the lower right and the
  compass at the top right, and a thing's page while the person stops at
  it, are the only things on the screen that are not the world: a tap on
  the minimap's land (or M) unfolds the field map out of it, a tap on its
  edge tucks it away, and the compass opens the slip. A tap on the open map
  is the one way to travel far at once: it is a paper action, so it belongs
  to the map, never to the world.
- **Paper you open holds the world still.** While the map or the slip is
  open, the world waits under a faint wash. A tap there folds the paper and
  moves no one, a drag there does nothing, and Esc folds it. The keys still
  walk, and the map's traveller follows. A thing's page is
  different: it rises on its own when the person stops at a thing, so it
  does not hold the world; a tap on it unfolds the rest of it, a tap
  elsewhere walks there and leaving lets it go.

Nothing in the world lights up, rings or changes under a pointer: a thing
looks the same whether or not a person could walk up to it, and the pointer
stays the hand that drags the view. Selecting is shown on paper instead: a
tap on a thing walks the person up to it, the minimap rings it in
vermilion pencil as they go, with its name beside the ring in the
traveller's hand, and on arrival the view turns to frame it and its
page rises at the lower left. So it is plain what was chosen, and
the world never shows a game's cursor.

## The field sheet

The field map, the minimap, a thing's page and the wait are one
sheet of the traveller's paper, so what tells a person where they are and
what a thing is belongs to the world rather than sitting on it. One
material language holds them (`map-styles.ts` is its data):

| Material | What it is | Where it shows |
| --- | --- | --- |
| Paper | Handmade cream paper, mottled and fibred, with a torn deckled edge; on the map one paper anchored to the world, running on unbroken past the land's paint; after dark read by the lantern, warm at its middle and falling into blue | The map's sheet, the minimap's scrap, a thing's page, the wait's sheet |
| Paint | Watercolor washes in health's colors, pooling at their rims and bleeding wet in wet; hills shaded violet and lit warm | The map, the minimap, the wait; a sketch's wash |
| Contours | Fine sepia lines from the real heights, every 1.2 m and every fifth heavier, drawn at the view's size so they look the same at every zoom: the map is a painted topographic map, so a person can read a rise before walking it; in the wild a little lighter on the bare paper | The map and the minimap, the land and the wild |
| Ink | One brown-black ink for names, borders, marks and sketches, and for the wild past the land, drawn as an old survey draws country; areas' names in upright, widely spaced capitals as a survey map letters its regions, small names in italic, edged with a little paper, never boxed | Every name on every sheet; the wild |
| Hand | The traveller's own notes, in a hand: what a thing's sketch shows is wrong, its vitality, and the name of the thing walked up to | A thing's page and the minimap's ring |
| Vermilion | The traveller's own marks: their cloak, a spot picked on the map, the pencil ring round a thing walked up to | The map and the minimap |

On the map, color means health and nothing else, so the map is a window
into vitality. Every area starts from one healthy green (`landWash`), a
little lighter or darker, warmer or cooler by its path so neighbors keep
apart, and each file's own vitality spreads over the ground around it,
weighed by its size and falling off over 24 m, across area borders too
(`healthField`), into one gradient over the land. The colors follow each
file's own number, so a color means the same health in every world:
thriving land a touch richer and deeper, then gold, russet and ash as
health falls (`healthColor`, `MAP_STYLE.health`), with the paper showing
through in dry-brush streaks where an area's own ground is tired. Trees
take the same colors by their files' vitality, and buildings and
landmarks wear their health in their marks: roofs dry and rot, smoke stops,
a tower's top falls and a ring's stones lie down, as they do in the world.
The colors read as the world's own seasons, so the map carries no legend.
The wait still washes each area in its land's color until it is rebuilt
to paint health as the map does.

Past the land the paper stays unwashed, because the wild stands for no code
and color means health, and ink draws the wild as an old survey
(`wild-ink.ts`): contours from its heights, and hachures down its slopes,
heavier on the slopes turned from the light; each thicket's bushes where
the world stands them, little crowns scalloped in ink with their shade side
and shadow hatched; tufts of grass where its golden steppe runs, a few on
its green grass, and stipple where it runs to scrub, thinning toward the
land as the land's own grass runs on past the rim. All of it comes from the
functions the world grows the wild from (`wildRollAt`, `wildShare`,
`wildPatch`, `wildScrub` and `wildThicket` in `@gaia/terrain`), so the map
and the world never disagree. The land's painting ends at its square, its
paint giving way raggedly to bare paper, and the ink runs up under that
ragged edge; the corners past the land's rounded rim stay painted like the
land beside them. Near the land the wild's relief eases from the height the
land holds a little inside its rim into the wild's own roll over 160 m, as
the land's relief eases at its rim, so no crest is inked as a ring round
the land. The wild has no end, so it is not painted onto one sheet: it is
inked in squares anchored to the world, each at one of a ladder of scales
twice apart, a few milliseconds at a time in the page's idle time ahead of
where the person is and where the map would open, and kept. A view lays the
squares nearest its own scale, crossfading between two as the map zooms, so
nothing is drawn afresh as the person walks and no mark appears or changes
as they go.

The sheets nest by scale, each growing out of the last so nothing jumps:
the minimap is the land around the person, turned to the way they face; a
tap unfolds it into the field map, which draws back from the minimap's
close view to the whole land and turns to north up as it comes; close in,
the map shows the next level down, each file's patch and name. A thing's
page is a sheet of its own, risen from the bottom edge at the lower left
while the person stops at the thing.

**What a thing says: the sketch is the news.** A thing's page
(`app/renderer/immersive/sketch.ts`) is a sheet of the traveller's
sketchbook, about 300 px wide, torn along its top and sides. It rises from
the bottom edge at the lower left over about a second when the person stops
at a thing, and sinks in less when they walk away; a new thing's page rises
once the last has sunk. Its face is the sketch: an ink drawing of the
thing, washed in its health, that the pen draws as the page rises. Every
kind of thing has its own drawing (`sketchKindOf`, by the words of what it
stands as): a house, a watermill, an archive tower, a keep, a lantern
tower, a ring of standing stones, a tree, a willow, a standing stone, a
boulder or slab, a family of stones, a bush, a feathery shrub and a drift of
flowers, and the drawing shows the health: a failing tree's crown thins and
browns, a roof sags, holes and ivy climbs the walls, a keep loses its
battlements, a lantern goes dark and then its top falls, a ring's lintels
and then its stones fall, moss leaves a stone and blooms fall from their
stems. A test fails when a building, landmark, shrub, stone or flower
Gaia can stand for code gets no drawing of its own kind. Up to two notes in
the traveller's hand sit on the sketch, the first over it and the second
under it, each on one line and tied by a dotted pencil leader to the part
it explains; they come in after the pen. Under the sketch: where it lives
in spaced capitals (its folders, and for a function or class its file
too), its name lettered as the map letters names, and beside the name its
vitality as a reading in the hand, such as 0.47, with no label, percent
sign or bar. A thing with nothing to note shows only these.

The rest is folded up behind the face, and a crease along the face's foot
shows it is there. A tap on the page swings the rest down below the face
as the page lifts to show it, and another tap folds it up; a rest too long
for the screen scrolls within the page. The page moves by transforms alone
and draws its shadow with its still paper, so a page that has risen costs
nothing a frame. A tap on the field map only ever sends the person to the
place; the page rises when they arrive and stop there.

What the page says is one typed value, `PageContent` in `sketch.ts`, made
by one function, `describe`. It is the Engine and Jev session's to change
as Gaia learns what is worth saying; this design only sets how the page
shows it:

- `notes`: each a few words and the part of the sketch they explain
  (`crown`, `trunk`, `roof`, `walls` or `ground`; every drawing has all
  five, a crown and a roof both its top, a trunk and walls its body). The
  face shows the first two, each on one line: a note too long for its line
  is set smaller, down to 11 px, and cut short past that.
- `rest`: any number of entries, in order. An entry with a label is a fact
  set beside its label, a line break in it starting a new line; one
  without is a line of prose in the hand.

Code draws the rest of the face: the sketch, where it lives, its name and
its vitality. Today `describe` fills the notes from the thing's vitality
signals (`symptomsOf`): only what is specific and true of this thing, so a
signal nearly every file shares (no test of its own, a warning or two) is
news only when it is the thing's real trouble. The rest holds the first
sentence of its doc comment, then where it lives, its size, what it leans
on, what leans on it, each reading that lowers its health, the strongest
first, and who judged it.

## Knowing where you are

The lab opens into the world, full screen, at eye height. Nothing sits on
it but the world, the three ways of knowing where you are, all at once, and
the compass in the corner: no panels, no readouts. The compass
(`app/renderer/immersive/compass.ts`) is a round of the map's paper, 44 px
across, with an inked ring of ticks that stays put, its top tick marking
the way the person faces, and a needle whose north half is in the
traveller's vermilion. Only the needle turns, to point north, on a damped
spring: after a sudden turn it swings about a tenth past and settles within
about a second. It is the one north on the screen besides the field map's
painted rose. A tap on it opens a slip with Gaia's mark, the world's name,
how to wander (for a mouse and keys, or for a finger) and the way back to
the debugging views (Components, Terrain and Skies). The hour follows the
person's clock (`?hour=22` pins it).
Everything a person reads here looks like the world's own things: warm
paper, brown ink, a serif with italic names and small capitals for paths,
and slow, soft motion; the traveller's own notes, on the minimap and a thing's page, are written in a hand. After
dark the paper (the map, the minimap, the slip, a thing's page) is
read by the lantern, a little warmer and dimmer. Until the first world
stands, the wait is alone on the screen; the ways of knowing where you are
and the compass come in as the wait lifts.

The immersive world opens on Gaia's own world. Where a person is comes from
one function, `placeAt` in `@gaia/terrain`: the area (a directory) whose land
they stand on, and the file whose patch of ground is underfoot, if any. In a
world laid out from code the land is all patches: each file's ground is a
few organic cells, its directory's area is its files' and subdirectories'
ground together, and an entity's lot is its area's own ground. Areas nest
and fill the land, and their borders wander like fields' and are where the
regions' covers change. In the sample world an area's
border runs where its region's landform gives way to the next, so the
islands where ground covers drift across a border never flicker a name, and
a file's patch is the ground around the tree that stands for it. Past the
codebase's land is the wild, which names nothing.

The three ways work together:

- **The minimap.** A torn scrap of the field map, about 156 px square,
  lies at the lower right (`app/renderer/immersive/minimap.ts`): the land
  around the person, about 130 m across, as the map paints it, turned with
  them so the way they face is always up. The traveller stands a little
  below its middle, so more of the way ahead shows, their footprints behind
  them. It is the local land, not the whole, and it carries no north: the
  compass points north. Its paint thins out unevenly over 6 px into 4 px of
  bare paper at its torn edge, so it parts from green grass without a drawn
  frame, and it lies close on the view under a light shadow. After 2.5 s in
  a new area the old name fades and the new one is lettered across the land
  near its top, as the field map letters areas: upright, widely spaced
  capitals with a narrow edge of paper round the letters, smaller for a
  long name, and a name that repeats carries just enough of its path above
  it in italic. A border walked along never changes the name. In the wild
  the old name fades after the same pause and nothing is written, since
  the wild stands for no directory. A tap on its land (or M) unfolds the
  field map out of it. A tap on its outer 16 px, or up to 6 px past its torn
  edge, tucks it: it slides slowly down past the screen's foot and leaves
  its top 50 px, the name and a band of turning land, showing; a tap on
  what shows brings it back. It costs almost nothing a frame: its canvas
  holds a window of the land wide enough to cover the scrap at any heading
  with 75 m to walk, drawn from the field map's painted paper in a few
  milliseconds, and one transform turns it about the traveller and
  slides it under the scrap; it is drawn again only as the person nears the
  window's edge or the paper is painted afresh. It is never bare: however
  far out in the wild, it shows the wild's ink around the person (see The
  field sheet), inked ahead of them, so drawing it out there lays only what
  is inked. After dark the lantern reads its paper and land alike, as it
  reads the map.
- **The field map.** A tap on the minimap (or M) unfolds the field map out
  of it: the sheet grows from the scrap to its place while its land draws
  back from the scrap's close view to the whole and turns from the way the
  person faces to north up, by transforms alone, and folds back into the
  scrap the same way. Its folds stay faintly creased. The sheet is handmade paper
  with a torn, deckled edge; a tap off the sheet, Esc or M folds it. Opened on the land, the land runs square to every edge of the sheet: the sheet
  ends at the land's square, with no margin. Opened from the wild, the
  sheet grows to take the traveller in: it frames the land and the
  traveller together, reaching 60 m past them (and never less than a few
  pixels, however far out they are), with the wild inked around the land's
  paint. Past the land's rounded
  rim each part of the sheet takes the health of the land nearest it, so
  painted country goes on into the corners. Nothing marks the rim: no pen
  inks it, the washes stop pooling a little inside it, the relief eases
  over its last 110 m to the height 60 m in so the hill shade draws no
  crest there, and the contours stop at it. The paint bleeds to the
  sheet's torn edge on every side, with nothing along it. The land is
  painted in health's colors (see The field sheet). Each area's pigment
  pools darker toward its rim and granulates into the paper's tooth, laid
  over a softened copy of itself so neighbors bleed into each other wet in
  wet, and broken by broad brush strokes a little warmer, cooler, lighter
  or darker; hills are shaded away from the light in the northwest. The
  linework is drawn at the view's size from the land's own shapes, so it
  looks the same on the whole sheet and close in: fine sepia contours from
  the real heights, every 1.2 m and every fifth heavier; each area's border
  as a soft hedgerow under a fine line; and each river as a line with a
  bank and a glint, as wide as the stream once the map comes close and
  never thinner than a line. Ponds are washed blue, darker toward their
  middle; trails are dotted; trees are round crowns in their files'
  health. Each kind of building and landmark has its own mark (`marks.ts`):
  an ink drawing over watercolor washes in its real colors, true to its
  shape in the world, seen from the south-southwest and lit from the
  northwest, worn by its entity's health (smoke thinning and stopping, a
  roof rotting to bare rafters, a keep losing its battlements, a ring's
  lintels and then its stones falling, a tree thinning to a snag). The marks
  keep a legible size on the whole sheet and grow with the land close in.
  Nothing on the sheet sits in a box, and it carries no title, legend or
  scale. Areas' names are lettered in ink on the land itself in upright,
  widely spaced capitals, slanting along the way each area runs, with a
  narrow edge of paper softening their letters. A name another area shares
  carries just enough of its path above it, in small italic, to tell it
  apart ("world" above SRC where another SRC sits elsewhere; `nameTails`),
  worked out from the folder names alone. Where the
  person stands, a small traveller in a vermilion cloak and a straw hat
  stands on the map on their own soft shadow, their last few footprints
  behind them along the way they look, the file underfoot lettered beside
  them; after dark their lantern glows. A compass rose is inked in the
  lower right corner, and a tap on the rose finds the traveller.
  After dark the sheet is read by the lantern: a warm pool low on the
  right, its edges falling into blue. Areas and patches are drawn from the
  outlines `outlinesOf` traces, never from a fixed shape. Names stay one size at any
  zoom and the larger area's name wins where two would collide. It pans
  and zooms by drag, pinch or scroll; a phone opens it close around the
  person, a wide screen shows it whole. Close in, past 2.4 times the whole
  sheet's zoom, the map shows its next level down: each file's patch in
  fine dotted ink with its name lettered small on it, in italic. A tap on an area's name from
  afar glides the map round to frame that area at that level; there, a tap
  on a file's name or a spot sends the person to it. Its paper is painted in steps of a
  few milliseconds in the page's idle time after a bake, so it never holds
  up a frame, and so is the wild's ink: the squares around the person first,
  before the new paper is shown, then those the map would open on.
  A tap on the open map, on a spot or (close in) on a name, sends the person
  there. The spot is marked with a cross in vermilion ink; the map folds away as the view
  clouds over in the map's own creased paper, the person is placed under it
  while the ground and grass follow, and the world dissolves back in at the
  new place, slower than it clouded, with no name spoken until it does. An
  area's name sends the person to its heart, a file's to its patch's. They land at eye height on the
  nearest dry ground (wading water only if nothing dry is near) clear of
  everything solid, in the area tapped, and in the wild only if the tap was
  there: on or beside a building, where its sign is read, looking at it; on a
  trail, looking along it toward the area's building or heart; elsewhere,
  looking toward the building or the heart. A double tap zooms and sends no
  one. `WorldHandle.landing` is the rule.
- **Markers in the world.** Where a trail crosses from one area into the
  next, a fingerpost stands beside it with an arm pointing each way along
  the trail, each painted with the name of the area that way, and across
  the tread a boundary stone is carved with both names, the one to the left
  above a cut line and the one to the right below it. An arm's paint fades,
  its wood greys and it droops on its nail with the vitality of the area it
  names (its files', its subdirectories' included, pooled by size: `areaVitality`); the stone's moss recedes and the stone
  bleaches with both areas'. Posts and stones stop a walker, and no grass
  grows through a stone. Every name fits its arm or its line on the stone,
  as on the signs (see Signs and cards); a long name's arm grows up to a
  third longer. Markers draw as three instanced meshes and cast no
  shadow.

## Gaia's mark

Gaia introduces itself with its own mark (`app/renderer/brand/`): a
lowercase "gaia" (`logo.svg`) and a mark alone for the page's icon
(`mark.svg`). The letters are cut from wood like the fingerpost arms, in a
calligraphic serif (Alegreya Black). The "ai" is freshly painted moss green
over the grain; on the outer "g" and "a" the paint has flaked away and the
wood has greyed and split, the way an arm weathers with its area. The i's
dot is a leaf on a twig, and the icon is an end-grain round with the leaf.
The letters are outlines from an open-licence typeface; the SVG files are
the source, and nothing redraws the mark in code. Every file is plain
paths, with no filters, gradients or IDs, so it inlines any number of times
and stays sharp at 16 px. The mark heads the slip and the start.

## Trails

A trail is a `link`: a dependency between two entities that Jev judges a
person would walk between. Jev fills only the trail's look, through
`trail@1`'s closed fields: its width (a narrow footpath to a broad cart
track), how worn its tread is, whether stones line its edges, how freely
it wanders, and whether it crosses a stream on stepping stones or a small
footbridge. Jev never draws the route. `planTrails` in `@gaia/terrain`
walks every trail over one network of paths, found over the baked ground:
the cheapest way at a gentle grade, around steep ground, ponds and deep
water, across a stream where it is narrow, and wandering off the easiest
line by a seeded field as far as the winding allows. Trails route most
wanted first, and each takes the ways earlier ones made wherever that is
less than about twice as far (walking a way costs 0.45 of fresh ground),
while ground within 4 m of a way, but off it, costs two and a half times
as much, so no trail runs beside another. Trails share trunk paths that
branch to each place at junctions. The network is cut into ways, stretches
of tread between two junctions or places, and each way knows every trail
that walks it and how far along each it lies. A way looks like its most
wanted trail's, as wide as its widest. Where three or more ways meet away
from a place (14 m or more from one), a small cairn of stacked stones
stands in the widest gap between them, clear of every tread, no nearer
than 40 m to another cairn. The same terrain, requests and seed always
give the same network. In Gaia's own world every one of the 18
dependencies Jev would walk is walked, on 15 ways and 3.4 km of tread.

The ground under a tread eases toward the tread's own grade, averaged over
14 m, and blends back into the land over 2.6 m, as a cottage's pad does; a
trail on a hillside benches gently into it, and no sample moves more than
55 cm. Water and its banks are never touched. The tread is worn earth from
the cover's own soil, darker down the trodden middle, with a ragged edge;
just outside it the grass is dulled and trampled shorter. Blades part along
the tread: each stands only past its own seeded edge, so the border is
ragged, and a faint trail keeps more blades on it. Trees keep 1.6 m off a
tread and the understory half a meter, and both keep off a cairn. A way
crosses a stream on a footbridge where it carries three trails or more, is
1.8 m wide or more, or a trail on it asks for one, and on stepping stones
otherwise. A footbridge's deck and stepping stones are walkable. Planks go
missing and rails sag as vitality falls.

A trail's wear follows the vitality of the two entities it joins, live.
Near each end it takes that end's entity's vitality, and it blends between
the two across the middle. Between thriving entities the tread is worn to
bare earth, as far as its blueprint's wear says; toward a failing entity
the grass grows back across it, its ragged edge closes and its earth fades
into the cover, until a faint trace and its edging stones are all that mark
the way (`trailWearAt`). A shared way is worn by every trail walking it,
and their wear adds up as chances do: a way worn to `a` by one trail and to
`b` by another is worn to 1 - (1 - a)(1 - b) (`wayWear`). So a trunk is
never less worn than its most worn trail, stays trodden while any trail on
it thrives, and grows over only when every trail on it fails; the branch
to a failing entity grows over alone. What is built on a way (footbridges,
stepping stones, edging stones) takes its liveliest trail's vitality where
it stands, since a way is kept in repair by whoever still walks it
(`wayVitalityAt`), and a cairn its liveliest way's (`junctionVitality`).
Where ways meet, the more worn one shows, so no seam appears. The bake
records which way each ground sample lies on and how far along it
(`trailPlaces`); the ground and grass shaders read each way's wear at four
stations along it from a small texture, rewritten from the entities'
vitality whenever it changes (`wayWearAt` is the CPU reference), so a
change in vitality never rebakes anything.

## Landmarks

A landmark is a great thing a person steers by: a lookout tower, a ring of
standing stones, or a great old tree. It stands for an entity, as a
building does: Jev decides which entities become landmarks (prominent ones
much of the code leans on suit them) and which become buildings, and
chooses the form. No rule fixes how many; its vitality is its entity's own. `findLandmarkSite` puts it
on the most prominent gentle, dry ground of its region, a knoll or a rise
near the region's heart, and levels its footprint into the land. Each
reads as a silhouette through the haze from 300 m and more, and declines
by breaking, not by fading:

- A tower's blocks fall from the top down, each at its own seeded
  threshold but never later than the blocks it rests on, so a failing
  tower is a jagged stump with fallen stone heaped at its foot and no
  block ever hangs over a gap. A falling block sinks down into the wall
  below it as it goes. Its crown goes first, in tiers (the roof and the
  lantern's glass, then the deck, posts, drum and battlements, then the
  walkway), each shrinking back onto what it stands on, never outlasting
  the wall that carries it; its lit windows go out one by one; an open
  lantern room glows at night like a beacon.
- Great stones lose their lintels and a dolmen its capstone first. A stone
  never bends: it leans whole about its toe (the edge of its foot), falls
  until it lies in the grass, or snaps, its top lying broken at its foot;
  a dolmen's capstone tips until its far edge rests on the ground. A
  cairn is courses of stones each bedded on the ones below; its top stones
  tumble first, sliding down the pile as they go.
- A great tree drops its leaves, sags and greys to a bare snag. Its crown
  is a flora crown at its scale (rooted clumps, or a willow's strands), so
  it bends and declines by the same rules, its sprays growing only with
  the square root of its size.

Each landmark primitive has a few strong axes that change the whole form,
as a tree's skeleton does, so the same three primitives make very
different landmarks:

- A tower's plan is round, square or eight-sided; it rises straight,
  tapering, or in stages that set back above a string course; a walkway
  on stepped corbels may ring its top or every stage; and it is crowned
  by a cone (a four- or eight-sided spire on a square or eight-sided
  tower), battlements, a lantern room, or a top already broken long ago.
- Great stones stand in a ring, an avenue of two facing rows rising toward
  its head, a dolmen of uprights under one capstone in a kerb of low
  stones, a field of cairns, or a loose group of lone menhirs, some
  already leaning.
- A great tree is a spreading oak, a tall elm, a great willow, an umbrella
  pine or a dark yew, and young, old or ancient: an ancient tree squats
  lower and broader on a buttressed trunk, some great limbs broken to
  stubs and its highest limbs bare above the crown.

What falls (rubble at a tower's foot, a snapped top, a fallen lintel)
grows in at its foot only once it has fallen, and never stops a walk.

Until worlds come from real code, the terrain lab stands a few landmarks,
more for more regions (about 1.4 times the square root of the region count:
seven in a full world of 22 regions), each for one of its sample entities,
on regions spread far apart; when it wants more than there are forms, forms
repeat. Buildings' floors and walks and landmarks' feet clear the
grass through the same mask as the understory, so a world may hold any
number of them.

## Detail at a distance

A person sees everything around them, near things in full and far things
thinned, and nothing ever appears, vanishes or changes shape as they move.
Every piece of a component (a leaf card, a limb, a petal) leaves whole at
its own seeded distance from the eye, smaller pieces first: a piece starts to
thin 720 times its size away, where it covers about a pixel, shrinks to its
center over the last 15% before it leaves, and draws nothing past that. Of
the pieces of one size, the share still there at a distance d past their
start is (start / d)², and each has grown by d / start, so together they
cover what the full detail would: a drift of daisies keeps its white far off
while its petals thin. A drift's petals start to thin about 14 m off; a
tree's finest twigs and blossoms between 30 and 120 m, and most of its leaf
cards near 300 m. A copy switches to a coarser level only where every piece that
level leaves out has already left, so the switch changes no pixel. Shadows
show the same pieces as the view, measured from the same eye, so the shade
under a tree never changes as a person walks. The water's mirror is drawn at
half the view's size, so it chooses its level of detail as if each copy
stood twice as far: a level it draws leaves out only pieces under a pixel of
the mirror.

A tree whose crown spans fewer than 128 device pixels on a pass's screen
draws as a card baked from the tree itself, by its own shaders, and lit
live, so far trees look like the near ones at every hour and every health.
Across a band from 128 to 160 pixels the card draws over the full tree, never
fading in on its own, so nothing appears or fades as a person walks. The
walk test (`pnpm probe steps`) holds every step toward the woods to the
wind's own change. Nothing is drawn past where the air has dissolved it into
the sky.

A pass draws only the cells its camera sees. The sun's shadow map covers a
box around the person, so only casters inside that box draw into it: its cost
stays bounded however large the world grows, and nothing outside it could
cast into it.

## Composition budgets

| Budget | Starting value |
| --- | --- |
| Paths | the network's treads cover at most 5% of any region's ground and 2% of the land |
| Open ground | at least 40% of a region |
| Landmarks | at most 1 per region |
| Tree spacing | about half a crown width to a crown between trunks in a grove, set by its area's character, never under 4.5 m; wider toward a grove's margin |
| Trees | about 470 in a world: past that every grove gives up the same share, keeping the tree that names its file |

Jev decides which dependencies become trails: every one it would walk. The
network, not a count of trails, holds the composition: `planTrails` routes
trails most wanted first and keeps each while the ground it adds (a shared
way adds none) keeps every region within its share and the land within
its own, so the world is never dominated by paths. A trail it cannot keep
is listed with the reason (`TrailNetwork.dropped`). Landmarks stand
about a quarter of the world's width apart.

## Groves and open ground

Land reads as groves, woods and copses with meadows and clearings between,
never as an orchard. Each file's trees stand as one grove on its own patch:
close-set at its heart, where crowns touch, thinning into scattered trees at
its margin, inside an outline of a few seeded lobes, so no two groves share a
shape and none is a circle. A longer file grows more trees, set a little
closer; a file that describes or configures grows none, so its patch is a
clearing. Each of a file's functions and classes stands in a small glade of
its own among its trees. Each area's character, which Jev chooses with its
reason, decides how its groves lie:

| Character | Its land |
| --- | --- |
| Deep wood | Its files' groves gather on the sides of their patches nearest the area's heart and knit into one wood, with meadow at its rim |
| Groves and clearings | Each grove keeps to its patch's middle, with clearings between |
| Old meadow | Open meadow where a file's one or two old trees, a third larger, stand alone among flowers |
| Rocky heath | Few, smaller trees; stones and low scrub over dry open ground |
| Wet hollow | Groves knit as in a wood, more loosely; reeds and marsh flowers over damp open ground |

In the sample world, which has no code behind it, groves gather by landform:
valleys and hills hold the most and the largest, a meadow a few lone trees.

## Understory

The understory grows where it belongs. Rocks lie in groups, bushes in
thickets, and wildflowers in drifts of one species, and each grows in its own
kind of place: shrubs and bluebells under a grove's canopy, shrubs at a
wood's edge and a lone tree's foot, daisies, poppies, lupines and asters in
open meadow and clearings, marsh marigolds and tall feathery shrubs by water,
stones where the ground is dry or steep (and on terraces, dunes and a heath's
open ground). Open meadow holds only flowers and the odd stone; wild brush
grows only past the land. `scatterComponents` in `@gaia/terrain` places them:
candidate group sites lie on a jittered grid fixed to the world, each site
reads its place from the trees' crowns, the water and the slope, and each
rule groups there by its density for that place, its region's landform and,
in a world from code, its area's character, with no two footprints
overlapping, nothing on ground steeper than its rule allows, and nothing
within a meter or two of water. Nothing crowds a file's finer entities: the
understory keeps two meters clear of each. In a world from code each rock,
bush and flower shows the vitality of the ground it grows on, as the grass
beneath it does (see Vitality on the land): its file's on a file's patch,
its whole area's on a lot (`areaVitality`), full health in the wild past the
land, and between patches the same soft blend, so a failing area's
understory fails with its trees and a live change in vitality reaches it.
A solid thing sits below the lowest ground
under its footprint, so on a slope its uphill side is buried and its
downhill side still touches the soil; a drift lies on the ground's plane, so
its stems stay upright. Rocks are half sunk by construction. Moss caps their
upward faces and recedes, edges first, drying to lichen grey as vitality
falls; the stone bleaches, and a boulder's two halves slump apart along a
fissure, so it cracks. Moss ends along a soft, winding edge that follows its
own depth across the stone, never the stone's facets, and that edge creeps
back toward each patch's heart as vitality falls. No blade of grass grows under a stone or through a bush's heart: a
mask of each one's outline at the ground clears it, so grass grows up
against a rock and never pierces it. Each blueprint draws as one instanced
mesh per part and level of detail, and drifts cast no shadow. Neighbors never look stamped: each
rock blueprint is built from two seeds and each bush from three (a variant
is one more instanced mesh per part), and every copy also varies its own
shape in the shader, seeded by where it stands: a little taller or squatter,
a lean, and a bulge to one side that grows from nothing at the ground, so the
cleared footprint still fits.

## Clouds

Fair-weather puffs, towering cumulus, cirrus streaks and low drifting banks.
Clouds on the horizon stand in columns: each bearing has its own height, so
towering cumulus rise from the haze in separate billowing towers with clear
sky between them, and banks run long, low and flat.
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
  the shadows once the sun has set. Its shadows rise from nothing as the sun
  sinks past the point where its light ends, so the switch never shows.
- **The lantern.** The person carries a candle-orange lantern at hand height,
  a little ahead and to the right. Its pool is about 12 m across and fades
  smoothly to nothing, with no edge; colors come back inside it. On pale,
  muted surfaces such as stone it reads as warm amber rather than full
  orange, which over the moon's blue floor would look salmon, and its
  brightest light rolls off. It lights surfaces only, never the air. It fades in through dusk, sways a few
  centimeters with each stride and settles when the person stops. The Flora
  tab carries none, so plants are judged under the moon alone.
- **The night sky** deepens to blue, keeping a trace of the world's own sky
  color. The chosen moon, the chosen stars, and clouds silvered by the moon.
  A river of stars is a band: a milky glow with a brighter core, split by a
  dark lane of dust. Its glow reaches lower than single stars, so a view
  across the land sees it rise from the horizon.
- **Lamplit windows.** Window glass is a dark pane holding a little sky by
  day; from dusk the lamp inside lights it in the glass swatch's warm
  color. As vitality falls the lamps go out one window at a time, and the
  chimney's smoke thins and stops.
- **The world's own glow** (the vitality `glow` channel, fireflies, living
  water) reads by contrast in the dark, a little stronger than by day and
  still below what draws the eye on its own. Wildflowers fade into their
  blades at night, and drifts fold their open faces shut.
