# Far trees are cards baked from the tree itself

A world draws every tree at the detail its size on screen needs, so woods can
grow as large as their land calls for and cost follows what is on screen, not
what is in the world:

- A tree whose crown spans fewer than 128 device pixels on a pass's screen
  draws as one card baked from its own build by its own shaders: healthy and
  withered color, normal, depth, glow and coverage per texel, from 96
  directions, lit live with the scene's sun, moon, wind and air. At 128
  pixels one texel of the baked views covers one pixel.
- Across a band from 128 to 160 pixels the card draws over the full tree,
  as far into its form as the crown is into the band, so a tree never
  changes form in one frame and never fades in on its own.
- A far tree shows its health through color baked per texel and through its
  crown thinning across coverage slices.
- Each pass chooses by its own size: the water's mirror, drawn at half the
  view's size, turns trees far sooner. Nothing past where the air has
  dissolved it into the sky is drawn.
- Far trees come first; the land's tiles, for worlds past about 2 km, after.
- Every tree build bakes under the wait, a few views a frame, and is stored
  by a hash of the build and the bake, so each build bakes once.

The walk test guards it: walking toward the woods, no step may change the
picture more than the wind already does in half a second, and every step
measured in Gaia's world and the proving ground stays under it.

## Why

At the proving ground's start the trees in view drew 5.8 million triangles,
about 15,000 each, because a tree 600 m away drew nearly as many as a near
one, and the water's mirror drew them all again. The reviewer: "I am not
convinced that hard capping things is right. I mean, what if we want at
5000m world!" and "whats SUPER IMPORTANT is that this doesnt cause a loss of
immersion because things you should be able to see arent there (too close
fog) or things you can see look incorrect, especially if they pop as you
move closer to them." On the band: "make sure this doesnt look weird like
entities appearing or fading in ... that would break world immersion."

## Settled

Pair session `gaia-v3` (`f8d282bc-7712-4894-9255-dcf4699f92cb`), the World
session's round 18: the reviewer chose a baked card, 128 px with a band,
color and slices, and far trees first. Built with the Components session,
which owns the far form (`packages/render/src/far.ts`); World owns which copy
draws which form (`app/renderer/terrain/woods.ts`).
