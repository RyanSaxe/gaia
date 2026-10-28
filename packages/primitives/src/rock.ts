// The rock kind's primitives: stones, a fallen log, a stump, and the moss that
// grows on them. Geometry is in ./geometry/rock.ts and ./geometry/wood.ts.

import { primitive, t } from "@gaia/schema";
import { barkParams } from "./flora.ts";
import { buildBoulder, buildFlatStone, buildMoss, buildOutcrop, buildStoneCluster } from "./geometry/rock.ts";
import { buildFallenLog, buildStump } from "./geometry/wood.ts";

const facets = t.scale("How the stone's faces are cut: worn smooth for code that feels old and much handled, softly faceted for code that feels weathered but sound, sharply faceted for code that feels raw, hard and new", {
  "worn smooth": 0.15,
  "softly faceted": 0.55,
  "sharply faceted": 1,
});

export const boulderParams = {
  size: t.scale("How tall the boulder stands above the ground: knee-high for code that feels small and stubborn, waist-high for code that feels solid, shoulder-high for code that feels weighty, taller than a person for code that feels immovable and imposing", {
    "knee-high": 0.6,
    "waist-high": 1.05,
    "shoulder-high": 1.5,
    "taller than a person": 2.2,
  }),
  shape: t.choice("The boulder's overall shape", {
    round: "A rounded dome, a little wider than tall, for code that feels comfortable and settled",
    egg: "Taller than wide, standing on end, for code that feels alert, upright and separate",
    wide: "Broad and squat, much wider than tall, for code that feels heavy and immovable",
    lopsided: "Uneven, leaning to one side, for code that feels awkward and off balance",
  }),
  facets,
};

export const boulder = primitive({
  id: "boulder@1",
  role: "Rock",
  doc: "One rounded boulder, half sunk into the ground, for code that feels heavy, patient and immovable.",
  params: boulderParams,
  build: (p, ctx) => buildBoulder(p, ctx),
});

export const flatStoneParams = {
  size: t.scale("How wide the stone is: a stepping stone for code that feels small and handy, a bench for code that feels restful, a table for code that feels broad and gathering", { "a stepping stone": 1, "a bench": 1.8, "a table": 2.8 }),
  top: t.choice("The stone's top", {
    level: "A level top you could sit on, for code that feels calm and inviting",
    tilted: "Tilted, as if heaved up by frost, for code that feels unsettled and upheaved",
    stepped: "Split into two tops, one a step above the other, for code that feels divided between two purposes",
  }),
  facets,
};

export const flatStone = primitive({
  id: "flat-stone@1",
  role: "Rock",
  doc: "A low, flat-topped stone, like a bench or a table set in the turf, for code that feels dependable and restful.",
  params: flatStoneParams,
  build: (p, ctx) => buildFlatStone(p, ctx),
});

export const stoneClusterParams = {
  count: t.scale("How many stones lie together: a few for code that feels like a small household, several for code that feels like a close family, many for code that feels like a crowd gathered round", { "a few": 3, several: 5, many: 8 }),
  size: t.scale("How tall the largest stone stands: knee-high for code that feels small and homely, waist-high for code that feels sturdy, shoulder-high for code that feels dominated by one large part", { "knee-high": 0.6, "waist-high": 1.05, "shoulder-high": 1.5 }),
  facets,
};

export const stoneCluster = primitive({
  id: "stone-cluster@1",
  role: "Rock",
  doc: "A group of stones lying together, one large and the rest smaller around it, for code that feels close-knit and huddled.",
  params: stoneClusterParams,
  build: (p, ctx) => buildStoneCluster(p, ctx),
});

export const outcropParams = {
  length: t.scale("How far the ledge runs: short for code that feels like a glimpse of something deeper, long for code that feels far-reaching, a long ridge for code that feels like the backbone of its area", { short: 4, long: 7, "a long ridge": 11 }),
  height: t.scale("How high it stands from the ground: barely breaking the turf for code that feels buried and quiet, knee-high for code that feels half exposed, waist-high for code that feels bare and unyielding", {
    "barely breaking the turf": 0.5,
    "knee-high": 0.9,
    "waist-high": 1.4,
  }),
  layering: t.choice("How the rock is layered", {
    massive: "One solid mass with a few soft cracks, for code that feels whole and monolithic",
    layered: "Stacked horizontal layers, like shale, for code that feels built up layer on layer over time",
    blocky: "Squared blocks split by joints, for code that feels sectioned and orderly",
  }),
};

export const outcrop = primitive({
  id: "outcrop@1",
  role: "Rock",
  doc: "A low ledge of bedrock breaking through the turf along a gentle curve, for code that feels old, deep-rooted and foundational.",
  params: outcropParams,
  build: (p, ctx) => buildOutcrop(p, ctx),
});

export const fallenLogParams = {
  length: t.scale("How long the log lies: a short length for code that feels like a leftover, a person's length for code that feels finished and set aside, a whole fallen trunk for code that feels like a large thing that has collapsed", {
    "a short length": 1.4,
    "a person's length": 2.4,
    "a whole fallen trunk": 4.5,
  }),
  girth: t.scale("How thick the log is: slender for code that feels slight, stout for code that feels solid, broad as an old oak for code that feels heavy and old", {
    slender: 0.13,
    stout: 0.22,
    "broad as an old oak": 0.34,
  }),
  ends: t.choice("How its ends were left", {
    sawn: "Sawn clean across, its rings showing, as if cut and left to lie, for code that feels deliberately set aside",
    broken: "Snapped and splintered, as if it came down in a storm, for code that feels broken off by some upheaval",
    "one of each": "Sawn at its foot and torn away at its top, for code that feels half finished, half abandoned",
  }),
  boughs: t.scale("What is left of its boughs: bare and smooth for code that feels stripped back, a few broken stubs for code that feels worn down, bristling with stubs for code that feels rough and full of old snags", {
    "bare and smooth": 0,
    "a few broken stubs": 2,
    "bristling with stubs": 5,
  }),
  bark: barkParams.roughness,
};

export const fallenLog = primitive({
  id: "fallen-log@1",
  role: "Rock",
  doc: "A fallen log in the grass, spent, peaceful and full of small life. As vitality falls its bark falls away to grey wood, its stubs break off, and it splits and sinks into the turf.",
  params: fallenLogParams,
  build: (p, ctx) => buildFallenLog(p, ctx),
});

export const stumpParams = {
  height: t.scale("How tall the stump stands: cut low to the ground for code that feels nearly gone, knee-high for code that feels cut back, waist-high for code that feels like a stubborn remnant", {
    "cut low to the ground": 0.3,
    "knee-high": 0.55,
    "waist-high": 1,
  }),
  top: t.choice("Its top", {
    sawn: "Sawn flat, its rings open to the sky, for code that feels cut short on purpose",
    broken: "Snapped off ragged, splinters standing up on one side, for code that feels broken off and abandoned",
  }),
  roots: t.scale("How far its roots spread: tucked in close for code that feels self-contained, gripping the ground for code that feels tenacious, sprawling over the ground for code that feels tangled into everything around it", {
    "tucked in close": 0.5,
    "gripping the ground": 1.1,
    "sprawling over the ground": 2.2,
  }),
  bark: barkParams.roughness,
};

export const stump = primitive({
  id: "stump@1",
  role: "Rock",
  doc: "An old stump with its roots still in the ground, stubborn, cut back and persistent. As vitality falls it splits and leans apart, and its top crumbles from the center into a soft, dark hollow.",
  params: stumpParams,
  build: (p, ctx) => buildStump(p, ctx),
});

export const mossParams = {
  cover: t.scale("How much of the stone or bark the moss covers: a few patches for code that feels lightly aged, a cap on top for code that feels settled in, thickly overgrown for code that feels long left alone", {
    "a few patches": 0.35,
    "a cap on top": 0.6,
    "thickly overgrown": 0.85,
  }),
  growth: t.choice("What grows on the stone or bark", {
    velvet: "Smooth velvet moss, for code that feels soft and quiet",
    cushions: "Plump cushions of moss, for code that feels cosy and long at rest",
    lichen: "A thin crust of lichen, for code that feels dry, ancient and barely changing",
  }),
};

export const moss = primitive({
  id: "moss@1",
  role: "Overgrowth",
  doc: "Moss on the upward faces of stone or bark, for code that feels old and settled. It recedes and dries to lichen grey as vitality falls.",
  params: mossParams,
  build: (p, ctx, base) => buildMoss(p, ctx, base),
});

export const ROCK_PRIMITIVES = [boulder, flatStone, stoneCluster, outcrop, fallenLog, stump, moss];
