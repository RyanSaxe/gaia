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
clump's surface, each with a few sprays along it and one at its tip. A
crown's spray is full: the family's leaves crowded around a short stalk,
overlapping, so the card is nearly all leaf and a third as many sprays
fill a crown. Elsewhere, as atop a willow's strands, a spray is a stalk
with leaves on short stalks alternating along it, its base on its twig.
No ball sits inside a crown, so up close the gaps show twigs, deeper
sprays and sky.
Each family has its own spray (`leaf-clumps@1`'s `leaf`): pointed, oval
(an apple's), lobed (a maple's), or blossom, umbels of five-petaled flowers
on fine stalks, their petals the family's pale bloom deepening to its leaf
color at the heart, with a few small leaves in the family's stem green (a
cherry's). A spray's stalks are the bark's color. A primitive only places
cards and names their cut (`CUT` in `@gaia/schema`: cluster, oval, lobed,
umbels, crowded and the full sprays, crowdedPointed, crowdedLobed and
crowdedUmbels, are sprays; strand, needles, patch and core); the
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
so a curtain never reads as ribbons. A great willow's leaves keep near
their own size, so it hangs more, narrower strands than a willow scaled
up, which would hang a few wide ones that read as slabs from afar. A fir
spray is a frond along its
limb: a ridge of needles along the limb and branchlets to either side that
reach toward the tip and droop, most of them doubled by a second card
hung lower beneath, so a fir reads as layered, feathery needles rather
than flat plates. A spire grows 1.4 whorls for each ring its look asks
for, and a frond's outer branchlets reach farther and hang over the whorl
below, so needles fill the sky between its levels. No crown, bush or frond has a dark body
inside it to read as dense: its fullness comes from its leaves.

A bush is seen close, where a spray's five small leaves cover too little
of their card to fill it, so a bush's leaves grow in crowded clusters
(`CUT.crowded`): fourteen rounded leaves overlapping around a short stalk,
their tips making the rim, each with its own shade, edge and moment to
drop. Short twigs from the stems carry the clusters over clumps at every
stem tip and along the stems, at three depths, smaller at the rim and
larger inside, faced out and up so few are seen edge-on. Uneven clumps,
notches in the rim and a few stray twigs give it a ragged outline, never a
dome. Leaves alone fill it: nothing dark stands inside a bush. From 2 m a
rounded bush fills 80% to 90% of its outline, at 4,900 to 6,300
triangles before its flowers or berries. Scrub grows low, wiry, arching stems with tufts of clusters at
most of its tips. A feathery shrub keeps its needle sprays. Blossoms are
umbels on stalks from the twigs, and berries hang in small clusters on
stalks.

Bark faces outward and draws front faces only. A trunk is one tube from the
ground to its fork, and each bough one tube from its joint to its tip, so
the bark's ridges run unbroken past the joins. Where boughs leave the top
of a trunk or limb, each starts as wide as its parent ends and narrows to
its own width, so no light band shows at the fork. Where a trunk meets the
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
  is thicker, so its trunk and boughs lean less (`WIND.build`). A fir's
  needles are too stiff to flutter, and a willow's strand too long to turn
  as one leaf, so both move only with their twig (`STIFF`). Grass, flowers,
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
40,000 triangles a plant (80,000 for a great tree). A crown thins its
twigs evenly to stay within its share, 24,000 triangles for a tree, placed
by the hundred, and twice that for a great tree, whose crown fills the
screen up close, where every layer of leaf cards costs its whole area to
draw. No crown ever drops a clump to fit. A fir's needles thin every
frond's branchlets evenly to stay within 26,000, since its many whorls
make its bark heavy. In that gust every
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
stops, so velocity never jumps.
A person always faces the way they walk, never stepping backwards or
sideways. Each key is a way to walk: W or the up arrow walks ahead; A or
the left arrow turns the person to face left and walks them that way, D or
the right arrow to the right, and S or the down arrow turns them around;
vim's k, h, l and j do the same. A key turns from the way the keys already
walk, so left pressed twice turns them around, and holding keys keeps them
walking that way until they let go. The keys' way and a tapped walk both
turn the person at a turn's pace, walking only as fast as they face their
way, so a way behind them is walked by turning round and setting off.
Their momentum turns with them, and a drag that turns the view turns the
keys' way with it and takes over from a tapped walk.
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

A stream winds across its valley's floor at its own scale, besides the
valley's own long winding: its bends lie 10 to 26 channel widths apart,
farther and swinging wider the more the valley winds, never turning tighter
than two widths, and within twice the floor (`bedOffset` in
`@gaia/primitives`), so a straight valley's stream barely wavers and a
strongly meandering one loops as real streams do. Streams run downstream along the flow solved from their bed (`streamFlow`
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

The ground takes the vitality of whatever it belongs to: a file's patch its
file's, an area's own ground (its lots) its area's, every
file under the area pooled by size (`areaVitality`), and the wild past the
land always thrives. A failing file in a healthy area is one sick patch in a
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

In the immersive world, a tap on a thing opens the journal at its page: a
building's or landmark's entity, a tree's file, and anything else its own.
The journal never opens on its own.

In the Terrain view, standing at a thing opens its card in the panel or the
sheet (`STOP_AT` in the terrain lab), and it reads like a page from a field
guide: what kind of thing it is, its name, what it does, where it lives in
the code, its size, what it leans on and what leans on it, what it stands
as in the world, who judged that (Jev, or the stand-in when Jev did not
answer), and its vitality as a percentage. Walking away, its × and Esc
close it.

While a codebase's world opens, the wait covers the screen
(`app/renderer/wait/`). It shows no words, counts or percentages and never
names Jev or OpenRouter: the progress a person sees is the world coming to
be, as the field map paints itself (see The field sheet). The field map's
own sheet lies before the start's map table, out of focus and still behind
it, the same size, paper and torn edge, with no fringe of wood, title or
turned-down corner. In the app only that paper shows for the moment
before the table is drawn; with the signpost, or in the standalone lab
with no start, the sheet lies on its creased paper instead. While the code is read
the sheet is bare and still, or, for a world chosen on the start, is that
world's picture as it was last walked, which stays as the sheet's paint
while the wait paints the world's own over it (and folds away if the land
has since grown into another shape). As soon as the land is divided, a pen draws
every area's border from the middle outward, the map's fine line, with the
hedgerow's soft band coming in under it, and never the land's rounded rim.
Between the borders and the washes, a pencil shows what Jev is doing to the
code, so a person can watch their codebase being read. Each file is
sketched round, lightly, while its area's looks are asked. It is hatched
once Jev has read its links, cross-hatched once Jev has read it for its
quality, and ringed again when Jev reads closer around it. Each area is
surveyed with short hachures inside its border as the folder pass reaches
it, the shallowest areas first. The pencil is graphite-grey and finer than
the pen, and each file's marks fade under its wash as the wash comes in, so
the finished map holds none of them.
Color is health, as on the map, and each file's health is Jev's judgment of
its quality, washed in once nothing more will be asked about the file. Each file's
health spreads over the ground around it as the map spreads it, and a part
of the sheet is painted only as nearly all the health there is settled, so
a color laid is never a color that later changes; until then that part
stays bare paper (`settling.ts`). Each change is painted by the field map's
own painter and comes in over a second or so, wet in wet. Each area's name
is lettered in the map's survey capitals, in the place the map letters it,
once its last answer about its looks is in, even before its health washes
in. While the world bakes, the pen draws each building's and
landmark's mark at its laid-out place, one by one from the middle outward.
Once the world stands, its relief is drawn in with the same hand: the pen
draws each river from its source to its mouth and each trail along its way,
and the hill shade, ponds, contours and trees wash in over each area's own
ground from the middle outward, as the health did, until the sheet is the
field map. Then the map folds away
as the field map does and the paper dissolves into the world, as a jump on
the map does, and the place's name is written on the minimap. After dark the
sheet is read by the lantern, warm at its middle and falling into blue at
its edges.

The sheet never sits still while Jev works, and nothing on it is made up:
there is no brush, no clear water and no drifting light, only strokes of
what has happened. Answers come in bursts, a slice of the understanding
pass at a time and seconds apart, but every stroke is drawn at a hand's
pace, one after another (`pace.ts`): names, pencil marks and washes each
keep their own queue, drawn calmly, and faster only so that a burst is drawn
by about when the next is due. So the pen follows the work by at most one
burst, never runs ahead of it, and once the world is ready to bake whatever
is left is drawn within a second and a half.

Everything in the wait that moves is an opacity or transform animation, or
a pen line's dash, so it keeps moving while the page stands the world, and
the world shows only after its first frames have drawn under the wait. The
washes, names and marks are painted a few milliseconds at a time in the
page's idle time, as the map paints its paper. When
judging would cost more than the person's spend limit, a small slip of warm
paper at the foot of the wait says what it costs against the limit and
that without it the world is drawn from the code alone, with two answers:
Go ahead, in moss green, and Not for this world, in ink, which the project
remembers until the limit changes. The world appears only once it is fully
judged.

## The start

When Gaia opens with no world named, the start lies over the wait
(`app/renderer/start/`), in its veil, so it follows the same hour. Once a
place is chosen, its map rises from the table and becomes the wait's sheet,
where the field map then paints itself as the world is opened, and the
table stays behind it until the world shows. A world opened with no start,
as on a reload, rises from the same table on a fresh card. It offers the worlds a
person walked before, a folder on this computer, and a line to write the
address of a place on GitHub. Nothing on it is a box or a word of jargon:
no "repository", "clone" or "Jev". An address that leads nowhere is
answered beneath it in a sentence in the world's voice ("Nothing open lies
at that address. It may be private, or spelled a little differently."). The
start does not say when a world was last walked. Two directions are built,
chosen by `CHOSEN_START` in `start.ts` or `?start=table|signpost` (a
standalone page shows it only when asked, with Gaia's own world as the one
walked before, pictured by `start/gaia-picture.webp`):

- **The map table in 3D** (shown; `table.ts`, `table-scene.ts`): a sheet
  folded in four on an oak table, with the worlds' cards, a quill, an
  inkwell and a brass lantern, all meshes lit by the world's own sun, sky,
  moon and lantern at the hour (the clock in the app, `?hour=` in the lab),
  with the light of "Meadow morning", since no world is open yet. The table
  faces so the sun comes from behind it on the left and rakes across the
  paper; after dark the moon lights the sheet blue and the lantern's candle
  warms it. The paper is made in its shader rather than painted: a warm
  cream with broad mottling, darker toward its rim, short fibres paler and
  darker than the sheet, a few foxing spots, the creases of its folds and a
  fine tooth; its edges are torn at three scales with loose fibres, paler
  and lit through, and catch the sun where they face it. The sheet settles
  into its folds and two corners curl. Wherever something touches the table
  or the sheet, a soft shade gathers under it, and the sun's shadows fall
  from the world's shadow map. Everything at the sheet's distance is sharp;
  the table beyond it is out of focus. Gaia's logo is printed at the
  sheet's head, with "the worlds you have walked" (or "where shall we
  wander?") under it in italic.
  - Each world walked before is a torn card in its land's shape, laid on
    the sheet a little askew, bowed, one corner lifted: the picture of its
    own field map in health's colors that its page painted when it was
    last opened, or plain paper with its name for a world with none yet. Its name is lettered
    beneath in the map's spaced capitals, broken onto two lines at a hyphen,
    dot or slash when it is long, with where it lies (who keeps it on
    GitHub, or the folder it sits in) in italic over it. Up to six worlds lie
    in rows between the words and the line, each as large as the room
    allows (`table-layout.ts`): one takes a card of 28 cm, six on a desktop
    still take 13 cm. On a phone the sheet stands upright on a deeper table,
    the inkwell and lantern beyond it and the quill at its foot, and more
    than three worlds lie in two rows.
  - The address is written in ink on the line from a text field no one
    sees. While Gaia asks after it, a darker stroke of ink runs along the
    line; an address that leads nowhere is answered under the line in
    red-brown ink, and "or open a folder on this computer", pencil
    underlined, moves down to make room. The folder's words open the app's
    folder dialog.
  - A tap on a card chooses its world: the card lifts 4 cm and straightens
    over half a second, its shadow sliding out from under it, then rises
    toward the person over 1.3 s and turns to face them, leaving the table's
    light. The eye follows it, so the table falls out of focus behind it,
    and the wait's sheet, unseen beneath the table, has taken the card's
    shape. The picture's margin closes as the card rises, so the card ends
    at the sheet's size and place as the sheet's own picture, edge to edge.
    As it rises it comes to be drawn exactly as the page draws the wait's
    sheet: the picture under the sheet's creases and edge shade, the sheet's
    deckle for its edge and the sheet's shadow under it, with nothing of the
    table's light or paper. The moment it lands the table goes behind the
    wait, held still and out of focus, and the sheet takes the card's place
    in that one frame, so nothing changes; the wait paints nothing new on the
    sheet until then, and paints the map from there. When the world stands,
    the sheet folds away into it as ever and the table goes with the veil.
  - A folder or an address gets a fresh card, in the shape the wait's sheet
    has and with the sheet's own bare paper for its face, laid on the line
    where the person asked for it (in the middle of an empty sheet): it
    comes down from the person's side over 0.45 s, then lifts and rises the
    same way. So does a world opened with no start, on an empty table.
  - It draws a frame only when something changes: the light as the hour
    turns, the ink on the line, a card moving. The sun's shadow map is drawn
    again only when the light changes, though the page passes the hour every
    frame. Behind the wait it draws nothing more, and once the world shows
    it lets go of its renderer, textures and geometry.
- **The world's edge**: standing where the land begins, at the hour it is,
  by a wooden signpost like the fingerposts in the world. Its arms are
  painted with the worlds walked before; one points "somewhere on this
  computer"; one is bare wood to write an address on, which creaks while the
  address is asked after. Hills fall away into haze behind it and a path
  sets out; after dark the stars are out, the post's lantern is lit and a
  few fireflies drift.

## One way to touch the world

A person never has to think about what a touch will do. Mouse, trackpad,
finger and keys all follow the same three rules.

- **The world moves you.** A tap or click on the world always means "go
  there". On the land, the person walks to the spot (a tap where they stand
  stops them). On a thing (a building, a tree, a landmark or its sign) they
  open the journal at its page. A
  tap on a rock, a bush, a fingerpost or a boundary stone walks up to it, never to
  the ground hidden behind it. A drag looks around and never walks. W A S D
  or the arrows walk and Shift hurries. A drag or a key takes the view back
  from a turn at once. Touching the world never does anything but move you.
- **Everything else is paper.** The closed journal at the lower left,
  with the minimap on its cover, and the compass at the top right are the
  only things on the screen that are not the world: a tap on the journal
  or the minimap's land (or M) opens the journal at its map, a tap on the
  minimap's edge tucks it away, "/" lays the journal's finder over the
  world, and the compass opens the slip. A tap on the open map
  is the one way to travel far at once: it is a paper action, so it belongs
  to the map, never to the world. While the land there is made ready, the
  paper that covers the view is the map around the place, coming slowly
  closer, so a jump never shows a blank sheet.
- **Paper you open holds the world still.** While the map or the slip is
  open, the world waits under a faint wash. A tap there folds the paper and
  moves no one, a drag there does nothing, and Esc folds it. The keys still
  walk, and the map's traveller follows.

The open journal's pages turn the way a book's do. A click or a tap on bare
paper turns that way, the right-hand page forward and the left back.
Anything on a page that answers a click of its own keeps it: a row, a name,
a fold, a way back, a map or a picture. The outer fifth of each page is its
edge. It lifts a little under the pointer, and a click there turns the page,
over a map or a picture too, though a row, a name, a fold or a way back
under it keeps its click. A mouse can take a page by its edge and a finger
anywhere, and either can draw it over. A swipe sideways on a trackpad, or
the wheel, turns one page a gesture, however long its momentum runs, and
the arrow keys turn one at a time. Where no page lies that way, on the
first spread's left and the last spread's right, the edge lies flat and
leaves a click to what is under it, and nothing turns. Nothing marks the
edges, which are paper like the rest of the page. A page is never turned
to before it is whole, its code and its painting come, and nothing on a page
changes once it is seen. While the page asked for is still being made, the
book leafs slowly through pages that are whole already (the contents, a
folder's list, code that has come), the way a reader looks for a page, and
turns to it once it is whole. A book opened at a page still being made
opens at the map and leafs on to it.

A page of the journal gives every score as a percentage, so it reads as a
share of 0 to 1. Beside a thing's name stand two numbers in the hand, each
under a small spaced-capital label and after a short meter filled to its
share: its quality, the meter in its health color, and its importance, the
meter in ink. Each row of a list carries both the same way, smaller, each
percentage at one width so the meters line up down the list.
The caption under a thing's picture gives each concept of quality Jev
answered as a percentage, and leaves out one whose answer doesn't count.
A file's first page leads with snippets of its weak and best definitions,
and a folder's with its weak and best files, each shown by its own weak or
best definition. The weak part is the one most in need among what matters
most (its lack of quality weighed by importance); the best is chosen from
the rest, among code that runs (never a type) scoring above the page
itself, by quality weighed by importance, so a page may have none. Each
snippet is its first line and a block (the one Jev picked as weak, or its
key block for the best), with the lines around folded into marks that say
how many, and a tap turns to its page. The weak part comes first when the
page is below the world's median quality, its best first otherwise. A long
definition's page opens on its weak block when it is below the median, and
on its key block otherwise. Its appendix is the code alone, with the same
marks. The marks are brush strokes in the margin, left of the handwritten
line numbers and their pencil rule, or beside a row: green for the key
block, russet for the weak part, slate blue for a page's best. Each marked
block is labeled in its stroke's color, **key**, **weak** or **best**, in a
column of its own so the names after it line up. Every fold reads the same,
"⋯ 20 lines" by hand where the code starts, and is a tap to its lines where
they can be read elsewhere: around a snippet's block, before and after a
definition's page, a definition folded in its file's text (with its page),
and past what the appendix sets.

Nothing in the world lights up, rings or changes under a pointer: a thing
looks the same whether or not a person could walk up to it, and the pointer
stays the hand that drags the view. Selecting is shown on paper instead: a
tap on a thing opens the journal at its page. So it is plain what was
chosen, and the world never shows a game's cursor.

## The field sheet

The field map, the minimap, the journal and the wait are one
sheet of the traveller's paper, so what tells a person where they are and
what a thing is belongs to the world rather than sitting on it. One
material language holds them (`map-styles.ts` is its data):

| Material | What it is | Where it shows |
| --- | --- | --- |
| Paper | Handmade cream paper, mottled and fibred, with a torn deckled edge; on the map one paper anchored to the world, running on unbroken past the land's paint; after dark read by the lantern, warm at its middle and falling into blue | The map's sheet, the minimap's scrap, the journal's pages, the wait's sheet |
| Paint | Watercolor washes in health's colors, pooling at their rims and bleeding wet in wet; hills shaded violet and lit warm | The map, the minimap, the wait |
| Contours | Fine sepia lines from the real heights, every 1.2 m and every fifth heavier, drawn at the view's size so they look the same at every zoom: the map is a painted topographic map, so a person can read a rise before walking it; in the wild a little lighter on the bare paper | The map and the minimap, the land and the wild |
| Ink | One brown-black ink for names, borders, marks and sketches, and for the wild past the land, drawn as an old survey draws country; areas' names in upright, widely spaced capitals as a survey map letters its regions, small names in italic, edged with a little paper, never boxed | Every name on every sheet; the wild |
| Hand | The traveller's own notes, in a hand: a page's numbers, a line's number, and the name of the thing walked up to | The journal and the minimap's ring |
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
The wait paints the same washes (`wash.ts`), each file's health as it
settles, and letters every area's name where the map letters it.

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

Each building's and landmark's mark is drawn from its own blueprint, never
chosen by name (`marks.ts`). A building's mark is the plan its footprint
realized, seen from the south-southwest and lit from the northwest: every
mass (the body, a wing, a porch, a lean-to, a turret) is drawn back to front
at the plan's own size, a unit to 0.67 m of land, with its door toward the
viewer and its roofs drawn 1.25 times as tall as they stand, so the
covering carries the mark. A table keyed by primitive id (`INKS`) says how
each slot's primitive is inked, and the palette gives every wash:

| Primitive | How the map inks it |
| --- | --- |
| `cottage-plan@1` | Every mass it lays out, joined masses trimmed where they meet |
| `timber-frame@1` | Posts, a rail at every floor, and braces or close studs as its framing says, on plaster |
| `fieldstone@1` | Coursed rounded stones as big as its stones, with boards or stone in its gables |
| `thatch@1` | Rounded edges as plump as the thatch, a thick eave and a capped ridge, the roof's color warmed toward straw |
| `tiles@1` | Fine courses of slates, rippled courses of pantiles or staggered shingles |
| `casements@1` | Dark panes at each window the plan places, glazing bars, shutters, and a plank, arched or hooded door |
| `cottage-garden@1` | The walk, a picket fence, flowers under the windows, a lantern by the door, a woodpile |
| `waterwheel@1` | The wheel at the free end, turned 35 degrees toward the viewer so it reads as a wheel, its flume or race |
| `tower@1` | A square tower at the back corner, quoined, under a pyramid cap or an open lantern |

One wear rule runs on every mass, as the building's ruin does: the roof
rots through from the weak corner (the front corner away from the door),
the wall breaches there, ivy climbs the corners nearest it, a lean-to caves
in, a turret's cone rots from its tip, and the chimney topples as its smoke
thins and stops. A landmark's mark follows its primitive's words: a tower's
plan, profile, galleries and crown; the stones' arrangement, count, height,
lintels and centre; a great tree's form, size, age and fullness, its crown
in the form's own green. A contract test fails when a structure or landmark
primitive has no entry in `INKS`, so a new primitive is never drawn as
something else. Each mark is drawn once into a bitmap at its size and
health and stamped from then on, because the map redraws on every frame of
a glide.

The sheets nest by scale, each growing out of the last so nothing jumps:
the minimap is the land around the person, turned to the way they face; a
tap unfolds it into the field map, which draws back from the minimap's
close view to the whole land and turns to north up as it comes; close in,
the map shows the next level down, each file's patch and name. A tap on a
thing opens the journal at its page. The minimap is cut from the field
map's paper, which is painted first while the wait is up. Until it is, the
scrap is bare paper, and its land washes in as the wait's layers do, never
popping in.

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
and slow, soft motion; the traveller's own notes, on the minimap and in the journal, are written in a hand. After
dark the paper (the map, the minimap, the slip, the journal) is
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
  lies under the strap of the closed journal's cover at the lower left
  (`app/renderer/immersive/minimap.ts`): the land
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
  bank and a glint along its real course, as wide as the stream once the
  map comes close and never thinner than a line, one drawing shared by
  the map, its picture and the wait's pen (`riverCourse`). Ponds are washed blue, darker toward their
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
  worked out from the folder names alone. Every area with ground of its
  own is lettered, and in the place the wait lettered it: both sheets
  place the names once for the whole sheet with `placeNames`
  (`map-names.ts`), from the areas' outlines and the lots where buildings
  and landmarks will stand, never from where the person stands. A name
  sits on its area's widest ground and never covers another name. It keeps
  off the compass rose's corner and off every building's and landmark's
  mark, keeping clear of all the ground any mark could take round its lot,
  since the wait letters names before it knows what will stand there.
  Where its own spot is taken it tries spots along its own slant and on
  every side of the mark in its way, then the same a little smaller, and
  only as a last resort sits over a mark, edged in paper as names are over
  trees. The smallest areas are lettered first, since they have the least
  room; a name whose own ground is hemmed in by others stands just beside
  it, and beside its own building or landmark when that is in the way.
  Where the
  person stands, a small traveller in a vermilion cloak and a straw hat
  stands on the map on their own soft shadow, their last few footprints
  behind them along the way they look, the file underfoot lettered beside
  them, the traveller and the file standing over the names, which never
  move for them; after dark their lantern glows. A compass rose is inked in the
  lower right corner, and a tap on the rose finds the traveller.
  After dark the sheet is read by the lantern: a warm pool low on the
  right, its edges falling into blue. Areas and patches are drawn from the
  outlines `outlinesOf` traces, never from a fixed shape. Names move with
  the land as the map pans and zooms and stay one size as it comes close;
  only a view that shows the land smaller than the whole sheet, opened from
  the wild, letters them smaller. As the map comes to its next level down,
  a name that stood off its own ground on the whole sheet fades across to
  its place there, where the land has room for it, as the files' names
  fade in. It pans
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

Gaia introduces itself with its own mark (`app/renderer/brand/`). Where it
is shown large, at the head of the start's sheet and of the slip the
compass opens, it is the reviewer's logo: a lowercase "gaia" in rounded
stone letters, the "ai" grown over with moss and leaves and the outer "g"
and "a" cracked and weathered, the way an area greys as its health falls.
It is a picture, not shapes, so it ships as WebP at the sizes it is shown
at on a 2x screen and no larger: 264 px wide for the slip's 132, and 640 px
for the start's sheet. On the slip it is multiplied into the paper, so its
pale stone takes the paper's tone, and the lantern's after dark, instead of
sitting on the flat paper like a cut-out; on the start it is printed into
the lit sheet, so the table's light falls on it with the paper's. Wherever
the mark is drawn small, as the window's icon, it is the flat round mark
(`mark.svg`): an end-grain round with a leaf, plain paths that stay sharp
at 16 px, where the logo's stone and moss would blur.

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
Where ways meet, the more worn one shows, so no seam appears. The land's
clipmap records which way each ground sample lies on and how far along it
(`trailPlacesOn`); the ground and grass shaders read each way's wear at four
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
  stubs and its highest limbs bare above the crown. An old tree's
  buttresses are thin blades of bark that stand tall at the trunk and
  sweep down to the ground, curving a little as they run out.

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

A tree whose crown spans fewer than 128 device pixels on a pass's screen (64
on a phone, which bakes its cards at that size) draws as a card baked from
the tree itself, by its own shaders, and lit
live, so far trees look like the near ones at every hour and every health.
Across a band from 128 to 160 pixels the card draws over the full tree, never
fading in on its own, so nothing appears or fades as a person walks. Just
past the band the full tree dissolves under its whole card, so the thin
strands, needles and berries a card cannot hold fade away instead of
vanishing in one frame. Trees turn far at the same size however dense the
view, so the woods never thin to keep frames up. Bushes, rocks and drifts of
flowers turn far the same way at a quarter of the size, 32 pixels (16 on a
phone). Anything that stands in copies, in either form, dissolves once its
crown spans fewer than 8 device pixels and is gone by 4, as the grass ends a
short way out: at a window 1860 pixels tall, a rock a meter across (a crown
of half a meter) goes between 210 and 420 m, and the smallest bush between
460 and 930 m. The walk test (`pnpm probe steps`) holds every step toward
the woods to the wind's own change, and the swap test (`pnpm probe swap`)
holds every far-turning preset's change of form, and its step across the
dissolve, to the same. Nothing is drawn past where the air has dissolved it
into the sky.

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
| Tree spacing | a tree keeps its crown's width from every other definition, never under 4.5 m between trunks |
| Trees | one for each definition Jev chooses a tree for, and no others in a world from code |

Jev decides which dependencies become trails: every one it would walk. The
network, not a count of trails, holds the composition: `planTrails` routes
trails most wanted first and keeps each while the ground it adds (a shared
way adds none) keeps every region within its share and the land within
its own, so the world is never dominated by paths. A trail it cannot keep
is listed with the reason (`TrailNetwork.dropped`). Landmarks stand
about a quarter of the world's width apart.

## Trees and open ground

Every tree in a world from code is a definition. Jev chooses what each
definition stands as, on its own: one of four trees (a lantern willow, a
fir, a cherry or an autumn maple), a stone, a bush or a drift of flowers. A
tree stands near where the layout put its definition, sized by its
importance, keeping its crown's width from everything else that stands for
code, so each tree reads as one thing, and a tap on it opens that
definition's page. Where Jev picks trees for many of a file's definitions,
its patch grows a copse; a file whose definitions are small routines is low
bushes and stones. Each area's character, which Jev chooses with its reason,
decides its ground:

| Character | Its land |
| --- | --- |
| Deep wood | Thick shrubs in the shade, and its trees grow a little taller |
| Groves and clearings | An even scatter of stones, shrubs and flowers |
| Old meadow | Open meadow thick with flowers, where trees grow a third larger |
| Rocky heath | Stones and low scrub over dry open ground, and its trees stay small |
| Wet hollow | Reeds and marsh flowers over damp open ground |

In the sample world, which has no code behind it, trees gather by landform:
valleys and hills hold the most and the largest, a meadow a few lone trees.

## Understory

The understory grows where it belongs. Rocks lie in groups, bushes in
thickets, and wildflowers in drifts of one species, and each grows in its own
kind of place: shrubs and bluebells under a tree's canopy, shrubs at a
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
