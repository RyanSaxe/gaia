// Rock primitives: the rock kind's bodies and the moss that grows on them.
// Geometry lives in ./geometry/rock.ts.

import { primitive, t } from "@gaia/schema";
import { buildBoulder, buildFlatStone, buildMoss, buildOutcrop, buildStoneCluster } from "./geometry/rock.ts";

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

export const mossParams = {
  cover: t.scale("How much of the stone the moss covers", {
    "a few patches": 0.35,
    "a cap on top": 0.6,
    "thickly overgrown": 0.85,
  }),
  growth: t.choice("What grows on the stone", {
    velvet: "Smooth velvet moss",
    cushions: "Plump cushions of moss",
    lichen: "A thin crust of lichen",
  }),
};

export const moss = primitive({
  id: "moss@1",
  role: "Overgrowth",
  doc: "Moss on the stone's upward faces; it recedes and dries to lichen grey as vitality falls.",
  params: mossParams,
  build: (p, ctx, base) => buildMoss(p, ctx, base),
});

export const ROCK_PRIMITIVES = [boulder, flatStone, stoneCluster, outcrop, moss];
