// Flora primitives: their declared parameters are the interface Jev fills.
// Geometry lives in ./geometry, one pure function per primitive.

import { primitive, t } from "@gaia/schema";
import { buildBark, buildBlossoms, buildLeafClumps, buildLeafStrands, buildNeedles } from "./geometry/foliage.ts";
import { growBranching, growSpire } from "./geometry/skeleton.ts";
import { buildLeafMound, growThicket } from "./geometry/shrub.ts";
import { PALETTE_FAMILIES, paletteOf } from "./palettes.ts";

export const branchingParams = {
  habit: t.choice("Overall growth form", {
    upright: "A central leader with rising limbs",
    spreading: "Wide, low limbs, broader than tall",
    weeping: "Limbs arch over and hang toward the ground",
    columnar: "Narrow and tall, with tight limbs",
  }),
  density: t.scale("How finely the limbs divide", {
    "a few heavy limbs": 2,
    "moderate branching": 3,
    "dense, fine twigwork": 4,
  }),
  spread: t.scale("Angle between sibling limbs, in degrees", {
    "tight, nearly parallel": 12,
    narrow: 24,
    open: 36,
    wide: 50,
    "flared, nearly horizontal": 66,
  }),
  stature: t.scale("Height compared with width", {
    "squat and broad": 0.7,
    balanced: 1.1,
    "tall and slender": 1.7,
  }),
};

export const branching = primitive({
  id: "branching@1",
  role: "Skeleton",
  doc: "A broadleaf tree's woody frame, grown by recursive splitting.",
  params: branchingParams,
  build: (p, ctx) => growBranching(p, ctx),
});

export const spireParams = {
  whorls: t.scale("How many rings of limbs climb the trunk", {
    "a few sparse rings": 4,
    "several rings": 7,
    "many close rings": 11,
  }),
  droop: t.scale("How the limbs hang", {
    "reaching upward": -0.3,
    level: 0,
    "drooping at the tips": 0.4,
  }),
  stature: t.scale("Height compared with width", {
    "broad cone": 1.4,
    "classic cone": 2.2,
    "narrow spire": 3.2,
  }),
};

export const spire = primitive({
  id: "spire@1",
  role: "Skeleton",
  doc: "A conifer's single straight trunk with rings of short limbs.",
  params: spireParams,
  build: (p, ctx) => growSpire(p, ctx),
});

export const barkParams = {
  roughness: t.scale("How rough the bark is", {
    smooth: 0,
    "lightly textured": 0.4,
    "deeply furrowed": 1,
  }),
};

export const bark = primitive({
  id: "bark@1",
  role: "Surface",
  doc: "Tapered limbs with bark.",
  params: barkParams,
  build: (p, ctx, skeleton) => buildBark(p, ctx, skeleton),
});

export const leafClumpsParams = {
  shape: t.choice("Shape of each clump of leaves", {
    round: "Soft, rounded clouds of leaves",
    plates: "Flat-topped layered plates, like a stone pine",
    tufts: "Small loose tufts at every twig",
  }),
  leaf: t.choice("The shape of each leaf", {
    pointed: "Slender pointed leaves, like a birch's or a beech's",
    oval: "Small rounded ovals, like a cherry's or an apple's",
    lobed: "Broad leaves with pointed lobes, like a maple's or a sycamore's",
  }),
  size: t.scale("Size of each clump", { small: 0.6, medium: 1, large: 1.5, "very large": 2.1 }),
  fullness: t.scale("How much of the frame the leaves hide", {
    "sparse, frame visible": 0.4,
    full: 0.75,
    "dense and lush": 1,
  }),
};

export const leafClumps = primitive({
  id: "leaf-clumps@1",
  role: "Foliage",
  doc: "Clumps of leaves at the limb tips.",
  params: leafClumpsParams,
  build: (p, ctx, skeleton) => buildLeafClumps(p, ctx, skeleton),
});

export const leafStrandsParams = {
  length: t.scale("How far the strands hang", {
    short: 0.6,
    "long, trailing": 1.4,
    "sweeping the ground": 2.4,
  }),
  fullness: t.scale("How thick the curtain of strands is", { airy: 0.4, full: 0.75, "dense curtain": 1 }),
};

export const leafStrands = primitive({
  id: "leaf-strands@1",
  role: "Foliage",
  doc: "Long hanging strands of small leaves, like a willow.",
  params: leafStrandsParams,
  build: (p, ctx, skeleton) => buildLeafStrands(p, ctx, skeleton),
});

export const needlesParams = {
  length: t.scale("Length of the needle sprays", { short: 0.5, medium: 0.9, long: 1.4 }),
  fullness: t.scale("How dense the needles are", { thin: 0.45, full: 0.8, "dense and dark": 1 }),
};

export const needles = primitive({
  id: "needles@1",
  role: "Foliage",
  doc: "Dense sprays of needles along each limb, like a fir.",
  params: needlesParams,
  build: (p, ctx, skeleton) => buildNeedles(p, ctx, skeleton),
});

export const blossomsParams = {
  form: t.choice("What grows among the leaves", {
    petals: "Small five-petaled flowers",
    pods: "Round seed pods that glow softly",
    berries: "Clusters of small berries",
  }),
  count: t.scale("How many", { "a scattered few": 0.25, plenty: 0.6, "covered in them": 1 }),
};

export const blossoms = primitive({
  id: "blossoms@1",
  role: "Ornament",
  doc: "Flowers, pods or berries among the foliage.",
  params: blossomsParams,
  build: (p, ctx, anchors) => buildBlossoms(p, ctx, anchors),
});

export const sway = primitive({
  id: "sway@1",
  role: "Motion",
  doc: "Movement in the wind.",
  params: {
    stiffness: t.scale("How the wind moves it", { supple: 0.9, "gently swaying": 0.55, stiff: 0.2 }),
    rhythm: t.scale("How quickly it moves", { slow: 0.35, gentle: 0.6, quick: 1.1 }),
  },
  build: (p) => ({ sway: p.stiffness, frequency: p.rhythm }),
});

export const palette = primitive({
  id: "palette@1",
  role: "Palette",
  doc: "The component's colors when healthy and in decline.",
  params: {
    family: t.choice("Color family", PALETTE_FAMILIES),
    contrast: t.scale("How strongly the colors differ", { soft: 0.6, balanced: 1, vivid: 1.35 }),
  },
  build: (p) => paletteOf(p.family, p.contrast),
});

export const thicketParams = {
  habit: t.choice("The shrub's overall form", {
    mound: "A rounded mound, a little wider than tall",
    spreading: "Low and wide, spilling outward",
    vase: "Upright stems flaring out like a vase",
  }),
  stems: t.scale("How many stems rise from the root", { "a few stems": 3, "several stems": 5, "a dense tangle": 8 }),
  stature: t.scale("How tall the shrub stands", { "knee-high": 0.6, "waist-high": 1.1, "head-high": 1.8 }),
};

export const thicket = primitive({
  id: "thicket@1",
  role: "Skeleton",
  doc: "A shrub's frame: many stems from one root crown, spreading into a low dome.",
  params: thicketParams,
  build: (p, ctx) => growThicket(p, ctx),
});

export const leafMoundParams = {
  leaves: t.choice("What the shrub's leaves are like", {
    rounded: "Soft, rounded clumps of small leaves",
    glossy: "Dense glossy clumps, like box or holly",
    feathery: "Loose, feathery sprays",
  }),
  fullness: t.scale("How much of the frame the leaves hide", { airy: 0.45, full: 0.75, "dense and clipped": 1 }),
};

export const leafMound = primitive({
  id: "leaf-mound@1",
  role: "Foliage",
  doc: "Layered leaves that hug a shrub's frame down to the ground, so it reads as one soft, leafy mound.",
  params: leafMoundParams,
  build: (p, ctx, skeleton) => buildLeafMound(p, ctx, skeleton),
});

export const FLORA_PRIMITIVES = [branching, spire, bark, leafClumps, leafStrands, needles, blossoms, sway, palette, thicket, leafMound];
