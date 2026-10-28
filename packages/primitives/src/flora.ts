// Flora primitives for trees and bushes. Jev fills each primitive's declared
// parameters, and a pure function in ./geometry builds its geometry.

import { primitive, t } from "@gaia/schema";
import { buildBark, buildBlossoms, buildFruit, buildJuniper, buildLeafClumps, buildLeafStrands, buildNeedles, oneTrunk } from "./geometry/foliage.ts";
import { growBranching, growSapling, growSpire } from "./geometry/skeleton.ts";
import { buildLeafMound, growBramble, growThicket } from "./geometry/shrub.ts";
import { COLOR_FEELS, paletteOf } from "./palettes.ts";

export const branchingParams = {
  habit: t.choice("How the tree grows", {
    upright: "A central leader with rising limbs, for code that feels steady and sure",
    spreading: "Wide, low limbs, broader than tall, for code that feels generous and sheltering",
    weeping: "Limbs that arch over and hang toward the ground, for code that feels gentle, wistful and inward",
    columnar: "Narrow and tall, with tight limbs, for code that feels formal and disciplined",
  }),
  density: t.scale("How finely the limbs divide: a few heavy limbs for code that feels plain and strong, moderate branching for code that feels even and ordinary, dense, fine twigwork for code that feels intricate and busy", {
    "a few heavy limbs": 2,
    "moderate branching": 3,
    "dense, fine twigwork": 4,
  }),
  spread: t.scale("How far its limbs open from each other: tight, nearly parallel for code that feels guarded and restrained, narrow for code that feels reserved, open for code that feels at ease, wide for code that feels welcoming, flared, nearly horizontal for code that feels expansive and far-reaching", {
    "tight, nearly parallel": 12,
    narrow: 24,
    open: 36,
    wide: 50,
    "flared, nearly horizontal": 66,
  }),
  stature: t.scale("How tall it stands for its width: squat and broad for code that feels grounded and stout, balanced for code that feels even-tempered, tall and slender for code that feels aspiring and light", {
    "squat and broad": 0.7,
    balanced: 1.1,
    "tall and slender": 1.7,
  }),
};

export const branching = primitive({
  id: "branching@1",
  role: "Skeleton",
  doc: "A broadleaf tree's woody frame, its limbs forking again and again, for code that has grown and branched over time.",
  params: branchingParams,
  build: (p, ctx) => growBranching(p, ctx),
});

export const spireParams = {
  whorls: t.scale("How many rings of limbs climb the trunk: a few sparse rings for code that feels lean and spare, several rings for code that feels orderly, many close rings for code that feels dense and layered", {
    "a few sparse rings": 4,
    "several rings": 7,
    "many close rings": 11,
  }),
  droop: t.scale("How its limbs hang: reaching upward for code that feels hopeful and alert, level for code that feels calm and measured, drooping at the tips for code that feels weary or burdened", {
    "reaching upward": -0.3,
    level: 0,
    "drooping at the tips": 0.4,
  }),
  stature: t.scale("How narrow its cone: a broad cone for code that feels sturdy and grounded, a classic cone for code that feels proper and expected, a narrow spire for code that feels austere and solitary", {
    "broad cone": 1.4,
    "classic cone": 2.2,
    "narrow spire": 3.2,
  }),
};

export const spire = primitive({
  id: "spire@1",
  role: "Skeleton",
  doc: "A conifer's single straight trunk with rings of short limbs, for code that feels upright, evergreen and watchful.",
  params: spireParams,
  build: (p, ctx) => growSpire(p, ctx),
});

export const saplingParams = {
  habit: t.choice("How the young tree is growing", {
    reaching: "A slender stem with a few shoots reaching straight up, for code that feels eager and fast-growing",
    tiered: "Neat, level tiers of branches up a straight stem, for code that feels patient and orderly",
    leaning: "A slim stem leaning toward the light, with uneven branches, for code that feels uncertain and searching",
  }),
  tiers: t.scale("How many tiers of branches it has grown: its first two for code that feels brand new, a few for code that feels young but taking shape, several for code that feels nearly grown", { "its first two": 2, "a few": 3, several: 5 }),
  stature: t.scale("How tall it has grown: knee-high for code that feels tentative, waist-high for code that feels still growing, as tall as a person for code that feels nearly mature", { "knee-high": 0.6, "waist-high": 1.1, "as tall as a person": 1.7 }),
};

export const sapling = primitive({
  id: "sapling@1",
  role: "Skeleton",
  doc: "A young tree no taller than a person, with one thin stem and a few tiers of slender branches, for code that feels new and still growing.",
  params: saplingParams,
  build: (p, ctx) => growSapling(p, ctx),
});

export const barkParams = {
  roughness: t.scale("How rough the bark is: smooth for code that feels young and easy to handle, lightly textured for code that feels lived in, deeply furrowed for code that feels old and weathered", {
    smooth: 0,
    "lightly textured": 0.4,
    "deeply furrowed": 1,
  }),
};

export const bark = primitive({
  id: "bark@1",
  role: "Surface",
  doc: "Tapered limbs with bark whose texture shows the code's age.",
  params: barkParams,
  build: (p, ctx, skeleton) => buildBark(p, ctx, skeleton),
});

export const leafClumpsParams = {
  shape: t.choice("How its leaves gather", {
    round: "Soft, rounded clouds of leaves, for code that feels gentle and comfortable",
    plates: "Flat-topped layered plates, like a stone pine, for code that feels composed and tiered",
    tufts: "Small loose tufts at every twig, for code that feels scattered and airy",
  }),
  leaf: t.choice("The shape of each leaf", {
    pointed: "Slender pointed leaves, like a birch's or a beech's, for code that feels light and quick",
    oval: "Small rounded ovals, like a cherry's or an apple's, for code that feels homely and friendly",
    lobed: "Broad leaves with pointed lobes, like a maple's or a sycamore's, for code that feels bold and full of character",
    blossom: "Clusters of five-petaled flowers on fine stalks with a few small leaves among them, like a cherry in full bloom, for code that feels joyful and celebrated",
  }),
  size: t.scale("How big each clump of leaves: small for code that feels fine and delicate, medium for code that feels ordinary, large for code that feels hearty, very large for code that feels lavish and overflowing", { small: 0.6, medium: 1, large: 1.5, "very large": 2.1 }),
  fullness: t.scale("How much of the frame the leaves hide: sparse, frame visible for code that feels thin or open to view, full for code that feels healthy and complete, dense and lush for code that feels abundant", {
    "sparse, frame visible": 0.4,
    full: 0.75,
    "dense and lush": 1,
  }),
};

export const leafClumps = primitive({
  id: "leaf-clumps@1",
  role: "Foliage",
  doc: "Clumps of leaves at the limb tips, each a fan of twigs carrying sprays of leaves, for code that feels leafy and alive.",
  params: leafClumpsParams,
  build: (p, ctx, skeleton) => buildLeafClumps(p, ctx, skeleton),
});

export const leafStrandsParams = {
  length: t.scale("How far the strands hang: short for code that feels neat and contained, long, trailing for code that feels relaxed and flowing, sweeping the ground for code that feels melancholy and deep", {
    short: 0.6,
    "long, trailing": 1.4,
    "sweeping the ground": 2.4,
  }),
  fullness: t.scale("How thick the curtain of strands: airy for code that feels open and light, full for code that feels sheltering, a dense curtain for code that feels private and screened off", { airy: 0.4, full: 0.75, "dense curtain": 1 }),
};

export const leafStrands = primitive({
  id: "leaf-strands@1",
  role: "Foliage",
  doc: "Long hanging strands of small leaves, like a willow, for code that feels soft, yielding and reflective.",
  params: leafStrandsParams,
  build: (p, ctx, skeleton) => buildLeafStrands(p, ctx, skeleton),
});

export const needlesParams = {
  length: t.scale("How long the needle sprays: short for code that feels clipped and terse, medium for code that feels steady, long for code that feels shaggy and old", { short: 0.5, medium: 0.9, long: 1.4 }),
  fullness: t.scale("How dense the needles: thin for code that feels sparse and exposed, full for code that feels sound, dense and dark for code that feels secretive and severe", { thin: 0.45, full: 0.8, "dense and dark": 1 }),
};

export const needles = primitive({
  id: "needles@1",
  role: "Foliage",
  doc: "Dense sprays of needles along each limb, like a fir, for code that feels evergreen, prickly and enduring. On a bush's many stems they grow in close tufts, like a juniper.",
  params: needlesParams,
  build: (p, ctx, skeleton) => (oneTrunk(skeleton) ? buildNeedles(p, ctx, skeleton) : buildJuniper(p, ctx, skeleton)),
});

export const blossomsParams = {
  form: t.choice("What grows among the leaves", {
    petals: "Small five-petaled flowers, for code that feels sweet and welcoming",
    pods: "Round seed pods that glow softly, for code that feels mysterious and a little magical",
    berries: "Clusters of small berries, for code that feels nourishing and homely",
  }),
  count: t.scale("How many: a scattered few for code that feels modest, plenty for code that feels generous, covered in them for code that feels exuberant and showy", { "a scattered few": 0.25, plenty: 0.6, "covered in them": 1 }),
};

export const blossoms = primitive({
  id: "blossoms@1",
  role: "Ornament",
  doc: "Flowers, pods or berries among the foliage, for code that feels in its season.",
  params: blossomsParams,
  build: (p, ctx, anchors) => buildBlossoms(p, ctx, anchors),
});

export const fruitParams = {
  fruit: t.choice("What fruit hangs from its twigs", {
    apples: "Round, plump apples, for code that feels wholesome and generous",
    pears: "Pears that swell below a narrow neck, for code that feels ripe, mellow and a little slow",
  }),
  crop: t.scale("How much fruit it bears: a scattered few for code that feels sparing, a good crop for code that feels productive, bowed with fruit for code that feels rich and heavily loaded", { "a scattered few": 0.2, "a good crop": 0.45, "bowed with fruit": 0.8 }),
};

export const fruit = primitive({
  id: "fruit@1",
  role: "Ornament",
  doc: "Apples or pears hanging on stalks from the twigs, under the outer leaves, for code that feels fruitful.",
  params: fruitParams,
  build: (p, ctx, anchors) => buildFruit(p, ctx, anchors),
});

export const sway = primitive({
  id: "sway@1",
  role: "Motion",
  doc: "Movement in the wind, as restless or as settled as the code feels.",
  params: {
    stiffness: t.scale("How the wind moves it: stiff for code that feels rigid and unchanging, gently swaying for code that feels easy, supple for code that feels flexible and yielding", { supple: 0.9, "gently swaying": 0.55, stiff: 0.2 }),
    rhythm: t.scale("How quickly it moves: slow for code that feels calm and unhurried, gentle for code that feels relaxed, quick for code that feels nervous and lively", { slow: 0.35, gentle: 0.6, quick: 1.1 }),
  },
  build: (p) => ({ sway: p.stiffness, frequency: p.rhythm }),
});

export const palette = primitive({
  id: "palette@1",
  role: "Palette",
  doc: "The component's colors at high and low vitality, in the mood of the code it represents.",
  params: {
    family: t.choice("Its colors", COLOR_FEELS),
    contrast: t.scale("How strongly the colors differ: soft for code that feels shy, faded or retiring, balanced for code that feels even-tempered, vivid for code that feels bold, loud or full of life", { soft: 0.6, balanced: 1, vivid: 1.35 }),
  },
  build: (p) => paletteOf(p.family, p.contrast),
});

export const thicketParams = {
  habit: t.choice("How the shrub grows", {
    mound: "A rounded mound, a little wider than tall, for code that feels snug and settled",
    spreading: "Low and wide, spilling outward, for code that feels easygoing and sprawling",
    vase: "Upright stems flaring out like a vase, for code that feels eager and reaching",
    scrub: "Low, wiry stems that fork and arch over, like scrub, for code that feels tough and spare",
  }),
  stems: t.scale("How many stems rise from the root: a few stems for code that feels simple, several stems for code that feels well rounded, a dense tangle for code that feels knotted and hard to see into", { "a few stems": 3, "several stems": 5, "a dense tangle": 8 }),
  stature: t.scale("How tall the shrub stands: knee-high for code that feels small and modest, waist-high for code that feels ordinary, head-high for code that feels imposing for its size", { "knee-high": 0.6, "waist-high": 1.1, "head-high": 1.8 }),
};

export const thicket = primitive({
  id: "thicket@1",
  role: "Skeleton",
  doc: "A shrub's frame of many stems from one root crown, spreading into a low dome, for code that feels close to the ground and busy with small things.",
  params: thicketParams,
  build: (p, ctx) => growThicket(p, ctx),
});

export const brambleParams = {
  canes: t.scale("How many canes arch from its root: a few wild canes for code that feels unruly but light, a thorny thicket for code that feels prickly and defended, an impenetrable tangle for code that feels hopelessly snarled", { "a few wild canes": 4, "a thorny thicket": 7, "an impenetrable tangle": 11 }),
  reach: t.scale("How far its canes arch out before they bow to the soil: humped and close for code that feels contained, sprawling for code that feels spreading and creeping, rambling far over the ground for code that feels spread through everything", { "humped and close": 1.2, sprawling: 1.8, "rambling far over the ground": 2.5 }),
  stature: t.scale("How high its arches stand: knee-high for code that feels low and creeping, waist-high for code that feels in the way, head-high for code that feels overgrown", { "knee-high": 0.6, "waist-high": 1, "head-high": 1.5 }),
};

export const bramble = primitive({
  id: "bramble@1",
  role: "Skeleton",
  doc: "A bramble's frame of long canes from one root that arch over and bend back to the soil, crossing into a tangle, for code that feels thorny and hard to get out of.",
  params: brambleParams,
  build: (p, ctx) => growBramble(p, ctx),
});

export const leafMoundParams = {
  leaves: t.choice("What the shrub's leaves are like", {
    rounded: "Soft, rounded clumps of small leaves, for code that feels gentle and plain",
    glossy: "Dense glossy clumps, like box or holly, for code that feels polished and strict",
    feathery: "Loose, feathery sprays, for code that feels airy and restless",
  }),
  fullness: t.scale("How much of the frame the leaves hide: in tufts at its tips for code that feels sparse and hardy, airy for code that feels open, full for code that feels healthy, dense and clipped for code that feels tidy and kept in hand", { "in tufts at its tips": 0.05, airy: 0.45, full: 0.75, "dense and clipped": 1 }),
};

export const leafMound = primitive({
  id: "leaf-mound@1",
  role: "Foliage",
  doc: "Crowded leaf clusters on short twigs that fill a shrub's frame down to the ground, with a ragged outline, so it looks like one leafy mass, for code that feels full and close-knit, or tufts at its tips, for scrub.",
  params: leafMoundParams,
  build: (p, ctx, skeleton) => buildLeafMound(p, ctx, skeleton),
});

export const FLORA_PRIMITIVES = [branching, spire, sapling, bark, leafClumps, leafStrands, needles, blossoms, fruit, sway, palette, thicket, bramble, leafMound];

/** The primitives a tree is composed from: a broadleaf or conifer frame, bark, four crowns, blossoms, fruit, sway and palette. */
export const TREE_PRIMITIVES = [branching, spire, bark, leafClumps, leafStrands, needles, leafMound, blossoms, fruit, sway, palette];

/**
 * The primitives a bush is composed from: a thicket, bramble or sapling frame and the crowns that suit a bush.
 * `needles` is left out. On a frame with many stems it builds juniper tufts (`buildJuniper`) of up to 20,000
 * triangles, too many for a bush the understory draws by the hundred.
 */
export const BUSH_PRIMITIVES = [thicket, bramble, sapling, bark, leafClumps, leafStrands, leafMound, blossoms, fruit, sway, palette];
