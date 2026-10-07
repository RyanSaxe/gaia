// Landmark primitives: great things a person steers by from far away, each
// 12 to 30 m tall so it reads through the haze from across the world.
// Geometry lives in ./geometry/landmark.ts.

import { primitive, t } from "@gaia/schema";
import { buildGreatTree, buildLookoutTower, buildStandingStones } from "./geometry/landmark.ts";

export const lookoutTowerParams = {
  height: t.scale("How tall the tower stands", { "a squat watchtower": 12, "a lookout tower": 16, "a tall tower": 21 }),
  shape: t.choice("The tower's plan", {
    round: "A round tower, like a mill or a lighthouse",
    square: "A square keep with flat walls",
  }),
  crown: t.choice("What crowns the tower", {
    "a conical roof": "A steep cone of a roof with a finial",
    battlements: "Notched battlements around an open top",
    "an open lantern room": "A glazed lantern room under a small roof, lit at night like a beacon",
  }),
  masonry: t.scale("The size of its stones", { "small, even blocks": 0.8, "dressed blocks": 1.1, "great rough blocks": 1.5 }),
};

export const lookoutTower = primitive({
  id: "lookout-tower@1",
  role: "Landmark",
  doc: "A stone lookout tower with slit windows lit at night; it crumbles from the top down as vitality falls.",
  params: lookoutTowerParams,
  build: (p, ctx) => buildLookoutTower(p, ctx),
});

export const standingStonesParams = {
  count: t.scale("How many stones stand in the ring", { "a few": 5, "a ring": 9, "a great ring": 13 }),
  height: t.scale("How tall the stones stand", { "head-high": 2.6, "twice a person's height": 3.8, towering: 5.2 }),
  lintels: t.flag("Do slabs lie across pairs of stones?", "Lintels across pairs of stones, like gateways", "Every stone stands alone"),
  centre: t.choice("What stands at the ring's center", {
    "a tall king stone": "One tall stone, taller than the ring",
    "an altar stone": "A low, broad flat stone",
    nothing: "Open grass",
  }),
  facets: t.scale("How the stones' faces are cut", { "worn smooth": 0.15, "softly faceted": 0.55, "sharply faceted": 1 }),
};

export const standingStones = primitive({
  id: "standing-stones@1",
  role: "Landmark",
  doc: "A ring of tall standing stones; in decline the lintels fall, and stones lean and break.",
  params: standingStonesParams,
  build: (p, ctx) => buildStandingStones(p, ctx),
});

export const greatTreeParams = {
  form: t.choice("What kind of great tree", {
    "a spreading oak": "Broad and low, its great limbs reaching far out",
    "a tall elm": "Tall, with rising limbs and a high domed crown",
    "a great willow": "A huge weeping crown of hanging strands",
  }),
  size: t.scale("How great it is", { great: 2.2, vast: 2.7, "ancient and immense": 3.2 }),
  fullness: t.scale("How full its crown is", { airy: 0.5, full: 0.8, "dense and lush": 1 }),
  bark: t.scale("How rough its bark is", { "smooth and grey": 0.1, "deeply furrowed": 0.7, "gnarled and burred": 1 }),
};

export const greatTree = primitive({
  id: "great-tree@1",
  role: "Landmark",
  doc: "One great old tree with a vast crown; in decline it drops its leaves and greys to a bare snag.",
  params: greatTreeParams,
  build: (p, ctx) => buildGreatTree(p, ctx),
});

export const LANDMARK_PRIMITIVES = [lookoutTower, standingStones, greatTree];
