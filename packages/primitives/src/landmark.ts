// Landmark primitives: great things a person steers by from far away, each
// 12 to 30 m tall, or spread wide, so it reads through the haze from across
// the world. A few strong axes per primitive change the whole form, so the
// same three primitives make very different landmarks. Geometry lives in
// ./geometry/landmark/.

import { primitive, t } from "@gaia/schema";
import { buildStandingStones } from "./geometry/landmark/stones.ts";
import { buildLookoutTower } from "./geometry/landmark/tower.ts";
import { buildGreatTree } from "./geometry/landmark/tree.ts";

export const lookoutTowerParams = {
  height: t.scale("How tall the tower stands", { "a squat watchtower": 12, "a lookout tower": 16, "a tall tower": 21, "a soaring tower": 25 }),
  plan: t.choice("The tower's plan on the ground", {
    round: "A round tower, like a mill or a lighthouse",
    square: "A square keep with flat walls and sharp corners",
    octagonal: "An eight-sided tower whose faces catch the light one by one",
  }),
  profile: t.choice("How the tower rises", {
    straight: "Straight walls, nearly as wide at the top as at the foot",
    tapering: "Walls that lean in as they rise, broad and rooted at the foot",
    stepped: "Stages, each narrower than the one below, set back above a string course",
  }),
  galleries: t.choice("Whether a walkway rings the tower", {
    none: "Plain walls up to the crown",
    "a gallery at the top": "A walkway on stone corbels ringing the top, under the crown, like a lighthouse's",
    "a gallery at every stage": "A corbelled walkway where each stage meets the next, and one at the top",
  }),
  crown: t.choice("What crowns the tower", {
    "a conical roof": "A steep cone of a roof with a finial; four- or eight-sided on a square or eight-sided tower",
    battlements: "Notched battlements around an open top",
    "an open lantern room": "A glazed lantern room under a small roof, lit at night like a beacon",
    "a broken top": "Long ago broken: an open, jagged top with no roof, fallen stone heaped at its foot",
  }),
  masonry: t.scale("The size of its stones", { "small, even blocks": 0.8, "dressed blocks": 1.1, "great rough blocks": 1.5 }),
};

export const lookoutTower = primitive({
  id: "lookout-tower@1",
  role: "Landmark",
  doc: "A stone tower: round, square or eight-sided, straight, tapering or in stages, with corbelled galleries and a roof, battlements, a lantern room or a broken top. Its slit windows are lit at night; it crumbles from the top down as vitality falls.",
  params: lookoutTowerParams,
  build: (p, ctx) => buildLookoutTower(p, ctx),
});

export const standingStonesParams = {
  arrangement: t.choice("How the stones are set out", {
    ring: "A ring of stones, their broad faces turned to its center",
    avenue: "An avenue: two facing rows of stones, rising toward its head",
    dolmen: "A dolmen: upright stones carrying one great flat capstone, inside a kerb of low stones",
    "cairn field": "Cairns: tall rounded piles of small stones scattered over the ground",
    "leaning menhirs": "Lone tall menhirs scattered loosely, some already leaning",
  }),
  count: t.scale("How many stones there are", { "a few": 5, "a good many": 9, "a great many": 13 }),
  height: t.scale("How tall the stones stand", { "head-high": 2.6, "twice a person's height": 3.8, towering: 5.2 }),
  lintels: t.flag("Do slabs lie across pairs of stones?", "Lintels across pairs of stones, like gateways", "Every stone stands alone"),
  centre: t.choice("What stands at the heart of the arrangement", {
    "a tall king stone": "One tall stone, taller than the rest",
    "an altar stone": "A low, broad flat stone",
    nothing: "Open grass",
  }),
  facets: t.scale("How the stones' faces are cut", { "worn smooth": 0.15, "softly faceted": 0.55, "sharply faceted": 1 }),
};

export const standingStones = primitive({
  id: "standing-stones@1",
  role: "Landmark",
  doc: "Great stones set by people long ago: a ring, an avenue, a dolmen, a field of cairns or a loose group of menhirs. In decline the lintels and capstone fall first; then stones lean whole, snap or fall flat into the grass.",
  params: standingStonesParams,
  build: (p, ctx) => buildStandingStones(p, ctx),
});

export const greatTreeParams = {
  form: t.choice("What kind of great tree", {
    "a spreading oak": "Broad and low, its great limbs reaching far out",
    "a tall elm": "Tall, with rising limbs and a high domed crown",
    "a great willow": "A huge weeping crown of hanging strands",
    "an umbrella pine": "A tall bare trunk holding up one broad, flat-topped umbrella of a crown, like a stone pine",
    "a dark yew": "A low, dense dome of small dark leaves, spreading wider than it is tall",
  }),
  size: t.scale("How great it is", { great: 2.2, vast: 2.7, "ancient and immense": 3.2 }),
  age: t.scale("How old the tree is", {
    "a young giant, still reaching": 0,
    "old and broad": 0.5,
    "ancient, storm-broken and stag-headed": 1,
  }),
  fullness: t.scale("How full its crown is", { airy: 0.5, full: 0.8, "dense and lush": 1 }),
  bark: t.scale("How rough its bark is", { "smooth and grey": 0.1, "deeply furrowed": 0.7, "gnarled and burred": 1 }),
};

export const greatTree = primitive({
  id: "great-tree@1",
  role: "Landmark",
  doc: "One great old tree with a vast crown, of a chosen form and age: an ancient one squats on a buttressed trunk with broken limbs and a bare crown top. In decline it drops its leaves and greys to a bare snag.",
  params: greatTreeParams,
  build: (p, ctx) => buildGreatTree(p, ctx),
});

export const LANDMARK_PRIMITIVES = [lookoutTower, standingStones, greatTree];
