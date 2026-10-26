// Rock primitives: the rock kind's bodies, stone and old wood lying still in
// the grass, and the moss that grows on them. Geometry lives in
// ./geometry/rock.ts and ./geometry/wood.ts.

import { primitive, t } from "@gaia/schema";
import { barkParams } from "./flora.ts";
import { buildBoulder, buildFlatStone, buildMoss, buildOutcrop, buildStoneCluster } from "./geometry/rock.ts";
import { buildFallenLog, buildStump } from "./geometry/wood.ts";

const facets = t.scale("How the stone's faces are cut", {
  "worn smooth": 0.15,
  "softly faceted": 0.55,
  "sharply faceted": 1,
});

export const boulderParams = {
  size: t.scale("How tall the boulder stands above the ground", {
    "knee-high": 0.6,
    "waist-high": 1.05,
    "shoulder-high": 1.5,
    "taller than a person": 2.2,
  }),
  shape: t.choice("The boulder's overall shape", {
    round: "A rounded dome, a little wider than tall",
    egg: "Taller than wide, standing on end",
    wide: "Broad and squat, much wider than tall",
    lopsided: "Uneven, leaning to one side",
  }),
  facets,
};

export const boulder = primitive({
  id: "boulder@1",
  role: "Rock",
  doc: "One rounded boulder, half sunk into the ground.",
  params: boulderParams,
  build: (p, ctx) => buildBoulder(p, ctx),
});

export const flatStoneParams = {
  size: t.scale("How wide the stone is", { "a stepping stone": 1, "a bench": 1.8, "a table": 2.8 }),
  top: t.choice("The stone's top", {
    level: "A level top you could sit on",
    tilted: "Tilted, as if heaved up by frost",
    stepped: "Split into two tops, one a step above the other",
  }),
  facets,
};

export const flatStone = primitive({
  id: "flat-stone@1",
  role: "Rock",
  doc: "A low, flat-topped stone, like a bench or a table set in the turf.",
  params: flatStoneParams,
  build: (p, ctx) => buildFlatStone(p, ctx),
});

export const stoneClusterParams = {
  count: t.scale("How many stones lie together", { "a few": 3, several: 5, many: 8 }),
  size: t.scale("How tall the largest stone stands", { "knee-high": 0.6, "waist-high": 1.05, "shoulder-high": 1.5 }),
  facets,
};

export const stoneCluster = primitive({
  id: "stone-cluster@1",
  role: "Rock",
  doc: "A family of stones lying together: one large, the rest smaller around it.",
  params: stoneClusterParams,
  build: (p, ctx) => buildStoneCluster(p, ctx),
});

export const outcropParams = {
  length: t.scale("How far the ledge runs", { short: 4, long: 7, "a long ridge": 11 }),
  height: t.scale("How high it stands from the ground", {
    "barely breaking the turf": 0.5,
    "knee-high": 0.9,
    "waist-high": 1.4,
  }),
  layering: t.choice("How the rock is layered", {
    massive: "One solid mass with a few soft cracks",
    layered: "Stacked horizontal layers, like shale",
    blocky: "Squared blocks split by joints",
  }),
};

export const outcrop = primitive({
  id: "outcrop@1",
  role: "Rock",
  doc: "A low ledge of bedrock breaking through the turf along a gentle curve.",
  params: outcropParams,
  build: (p, ctx) => buildOutcrop(p, ctx),
});

export const fallenLogParams = {
  length: t.scale("How long the log lies", {
    "a short length": 1.4,
    "a person's length": 2.4,
    "a whole fallen trunk": 4.5,
  }),
  girth: t.scale("How thick the log is", {
    slender: 0.13,
    stout: 0.22,
    "broad as an old oak": 0.34,
  }),
  ends: t.choice("How its ends were left", {
    sawn: "Sawn clean across, its rings showing, as if cut and left to lie",
    broken: "Snapped and splintered, as if it came down in a storm",
    "one of each": "Sawn at its foot and torn away at its top",
  }),
  boughs: t.scale("What is left of its boughs", {
    "bare and smooth": 0,
    "a few broken stubs": 2,
    "bristling with stubs": 5,
  }),
  bark: barkParams.roughness,
};

export const fallenLog = primitive({
  id: "fallen-log@1",
  role: "Rock",
  doc: "A fallen log lying in the grass, spent and peaceful, full of small life. As it fails its bark falls away to grey wood, its stubs break off, and it splits and sinks into the turf.",
  params: fallenLogParams,
  build: (p, ctx) => buildFallenLog(p, ctx),
});

export const stumpParams = {
  height: t.scale("How tall the stump stands", {
    "cut low to the ground": 0.3,
    "knee-high": 0.55,
    "waist-high": 1,
  }),
  top: t.choice("Its top", {
    sawn: "Sawn flat, its rings open to the sky",
    broken: "Snapped off ragged, splinters standing up on one side",
  }),
  roots: t.scale("How far its roots spread", {
    "tucked in close": 0.5,
    "gripping the ground": 1.1,
    "sprawling over the ground": 2.2,
  }),
  bark: barkParams.roughness,
};

export const stump = primitive({
  id: "stump@1",
  role: "Rock",
  doc: "An old stump with its roots still in the ground, stubborn, cut back and still holding on. As it fails its top splits and rots into a hollow, and crumbs of wood gather at its foot.",
  params: stumpParams,
  build: (p, ctx) => buildStump(p, ctx),
});

export const mossParams = {
  cover: t.scale("How much of the stone or bark the moss covers", {
    "a few patches": 0.35,
    "a cap on top": 0.6,
    "thickly overgrown": 0.85,
  }),
  growth: t.choice("What grows on the stone or bark", {
    velvet: "Smooth velvet moss",
    cushions: "Plump cushions of moss",
    lichen: "A thin crust of lichen",
  }),
};

export const moss = primitive({
  id: "moss@1",
  role: "Overgrowth",
  doc: "Moss on the upward faces of stone or bark; it recedes and dries to lichen grey as vitality falls.",
  params: mossParams,
  build: (p, ctx, base) => buildMoss(p, ctx, base),
});

export const ROCK_PRIMITIVES = [boulder, flatStone, stoneCluster, outcrop, fallenLog, stump, moss];
