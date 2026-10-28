// Landmark primitives build the large forms a person navigates by. Each is 12
// to 30 m tall or as wide, so it stays visible through the haze across the
// world. Each build's seed picks its proportions within the bands of its answers
// (`landmarkShape`), so two landmarks with the same answers still differ.
// Geometry is in ./geometry/landmark/.

import { primitive, t } from "@gaia/schema";
import { ROCK_ARCH_SHAPE, buildRockArch } from "./geometry/landmark/arch.ts";
import { ROTUNDA_SHAPE, ROTUNDA_STEPS, buildRotunda } from "./geometry/landmark/rotunda.ts";
import type { Bands } from "./geometry/landmark/shared.ts";
import { STANDING_STONES_SHAPE, buildStandingStones } from "./geometry/landmark/stones.ts";
import { TOWER_SHAPE, buildLookoutTower } from "./geometry/landmark/tower.ts";
import { buildGreatTree } from "./geometry/landmark/tree.ts";
import { WINDMILL_SHAPE, buildWindmill } from "./geometry/landmark/windmill.ts";

export const lookoutTowerParams = {
  height: t.scale("How tall the tower stands: a squat watchtower for code that feels humble and stubborn, a lookout tower for code that feels ordinary and steady, a tall tower for code that feels proud, a soaring tower for code that feels grand and ambitious", { "a squat watchtower": 12, "a lookout tower": 16, "a tall tower": 21, "a soaring tower": 25 }),
  plan: t.choice("The tower's plan on the ground", {
    round: "A round tower, like a mill or a lighthouse, for code that feels well-worn and much handled, smoothed by many hands",
    square: "A square keep with flat walls and sharp corners, for code that feels strict and severe, laying down the rules",
    octagonal: "An eight-sided tower whose faces catch the light one by one, for code that feels intricate and many-sided, put to many uses",
  }),
  profile: t.choice("How the tower rises", {
    straight: "Straight walls, nearly as wide at the top as at the foot, for code that feels plain and direct",
    tapering: "Walls that lean in as they rise, broad and rooted at the foot, for code that feels heavy, old and rooted in its ground",
    stepped: "Stages, each narrower than the one below, set back above a string course, for code that feels built up stage by stage over time",
  }),
  galleries: t.choice("Whether a walkway rings the tower", {
    none: "Plain walls up to the crown, for code that feels humble and closed, with nowhere to stand and look",
    "a gallery at the top": "A walkway on stone corbels ringing the top, under the crown, for code that feels lofty and aloof, keeping its one high view to itself",
    "a gallery at every stage": "A corbelled walkway where each stage meets the next, and one at the top, for code that feels busy and welcoming, with somewhere to stand at every level",
  }),
  crown: t.choice("What crowns the tower", {
    "a conical roof": "A steep cone of a roof with a finial; four- or eight-sided on a square or eight-sided tower, for code that feels homely and dependable, keeping a roof over its people",
    battlements: "Notched battlements around an open top, for code that feels guarded and defiant, holding the line",
    "an open lantern room": "A glazed lantern room under a small roof, lit at night like a beacon, for code that feels new and hopeful, only lately lit",
  }),
  masonry: t.scale("The size of its stones: small, even blocks for code that feels neat and careful, dressed blocks for code that feels solid and well made, great rough blocks for code that feels raw, old and heavy", { "small, even blocks": 0.8, "dressed blocks": 1.1, "great rough blocks": 1.5 }),
};

export const lookoutTower = primitive({
  id: "lookout-tower@1",
  role: "Landmark",
  doc: "A stone tower: round, square or eight-sided, straight, tapering or in stages, with corbelled galleries and a roof, battlements or a lantern room, for code that feels lonely and wind-bitten, forever watching the horizon. Its slit windows are lit at night; it crumbles from the top down as vitality falls.",
  params: lookoutTowerParams,
  build: (p, ctx) => buildLookoutTower(p, ctx),
});

export const standingStonesParams = {
  arrangement: t.choice("How the stones are set out", {
    ring: "A ring of stones, their broad faces turned to its center, for code that feels gathered and communal, everything turned toward one heart",
    avenue: "An avenue: two facing rows of stones, rising toward its head, for code that feels processional, leading you on toward something",
    dolmen: "A dolmen: upright stones carrying one great flat capstone, inside a kerb of low stones, for code that feels solemn and burdened, holding up one great weight",
    "cairn field": "Cairns: tall rounded piles of small stones scattered over the ground, for code that feels piled up patiently, a little at a time",
    "leaning menhirs": "Lone tall menhirs scattered loosely, some already leaning, for code that feels wild and untamed, its pieces standing apart",
  }),
  count: t.scale("How many stones there are: a few for code that feels sparse and quiet, a good many for code that feels steady and complete, a great many for code that feels crowded and busy", { "a few": 5, "a good many": 9, "a great many": 13 }),
  height: t.scale("How tall the stones stand: head-high for code that feels humble and near, twice a person's height for code that feels imposing, towering for code that feels overwhelming and awe-struck", { "head-high": 2.6, "twice a person's height": 3.8, towering: 5.2 }),
  lintels: t.flag("Do slabs lie across pairs of stones?", "Lintels across pairs of stones, like gateways, for code that feels like a passage from one place to another", "Every stone stands alone, for code whose pieces keep apart"),
  centre: t.choice("What stands at the heart of the arrangement", {
    "a tall king stone": "One tall stone, taller than the rest, for code with one proud master at its heart",
    "an altar stone": "A low, broad flat stone, for code that feels like a place where things are laid down and kept",
    nothing: "Open grass, for code whose heart is empty space that everything shares",
  }),
  facets: t.scale("How the stones' faces are cut: worn smooth for code that feels softened by long use, softly faceted for code that feels weathered but whole, sharply faceted for code that feels fresh-cut and severe", { "worn smooth": 0.15, "softly faceted": 0.55, "sharply faceted": 1 }),
};

export const standingStones = primitive({
  id: "standing-stones@1",
  role: "Landmark",
  doc: "Great stones set by people long ago: a ring, an avenue, a dolmen, a field of cairns or a loose group of menhirs, for code that feels ancient and patient, older than anything around it. In decline the lintels and capstone fall first; then stones lean whole, snap or fall flat into the grass.",
  params: standingStonesParams,
  build: (p, ctx) => buildStandingStones(p, ctx),
});

export const greatTreeParams = {
  form: t.choice("What kind of great tree", {
    "a spreading oak": "Broad and low, its great limbs reaching far out, for code that feels gnarled and obstinate, refusing to be moved",
    "a tall elm": "Tall, with rising limbs and a high domed crown, for code that feels tall, proud and upright, still reaching higher",
    "a great willow": "A huge weeping crown of hanging strands, for code that feels soft and sprawling, trailing many long threads",
    "an umbrella pine": "A tall bare trunk holding up one broad, flat-topped umbrella of a crown, like a stone pine, for code that feels like a gathering place, everyone drawn under one wide, sunny shade",
    "a dark yew": "A low, dense dome of small dark leaves, spreading wider than it is tall, for code that feels secretive and ancient, keeping something old and dark",
  }),
  size: t.scale("How great it is: great for code that feels close and friendly, vast for code that feels open-armed and generous, ancient and immense for code that feels solemn and awe-inspiring", { great: 2.2, vast: 2.7, "ancient and immense": 3.2 }),
  age: t.scale("How old the tree is: a young giant for code that is new and still growing fast, old and broad for code that feels settled, ancient and storm-broken for code that feels battered and patched, scarred by many storms", {
    "a young giant, still reaching": 0,
    "old and broad": 0.5,
    "ancient, storm-broken and stag-headed": 1,
  }),
  fullness: t.scale("How full its crown is: airy for code that feels light and open, full for code that feels healthy and even, dense and lush for code that feels rich, crowded and abundant", { airy: 0.5, full: 0.8, "dense and lush": 1 }),
  bark: t.scale("How rough its bark is: smooth and grey for code that feels clean and calm, deeply furrowed for code that feels lined with age, gnarled and burred for code that feels knotted and hard to read", { "smooth and grey": 0.1, "deeply furrowed": 0.7, "gnarled and burred": 1 }),
};

export const greatTree = primitive({
  id: "great-tree@1",
  role: "Landmark",
  doc: "One great old tree with a vast crown, of a chosen form and age, for code that feels warm, alive and sprawling, a gathering place: an ancient one squats on a buttressed trunk with broken limbs and a bare crown top. In decline it drops its leaves and greys to a bare snag.",
  params: greatTreeParams,
  build: (p, ctx) => buildGreatTree(p, ctx),
});

export const windmillParams = {
  body: t.choice("What kind of mill it is", {
    "a stone tower mill": "A tall round tower of stone, broad at its foot and tapering as it rises, a stage ringing it where the sails sweep low, under a domed cap, for code that feels sturdy and long-serving, built to outlast the people who made it",
    "a timber smock mill": "Eight sides of pale weatherboards leaning in as they rise, like a countryman's smock, on a stone base with a stage around it, under a pointed cap, for code that feels homely and modest, patched and kept turning by hand",
    "a post mill": "A boarded wooden body perched on one great post over crossed trestles, a ladder and a tail pole trailing behind it, for code that feels light and makeshift, balanced on a single prop",
  }),
  sails: t.choice("Its sails", {
    "four canvas sails": "Four broad sails of pale canvas spread on lattice frames, full of the wind, for code that feels old-fashioned and honest, made the way it always has been",
    "four lattice sails": "Four sails of white shutters, slatted like blinds, the light flickering through them as they turn, for code that feels fussy and precise, every slat set just so",
    "six sails": "Six slender canvas sails crowding round one hub, a quick, restless whirl, for code that feels restless and hurried, always spinning a little too fast",
  }),
  height: t.scale("How tall it stands to the top of its cap; its sails reach higher still: a stout mill for code that feels humble and close to the ground, a tall mill for code that feels proud of its work, a towering mill for code that feels ambitious, reaching up for every breath of wind", { "a stout mill": 16, "a tall mill": 20, "a towering mill": 25 }),
};

export const windmill = primitive({
  id: "windmill@1",
  role: "Landmark",
  doc: "A windmill whose sails turn all day and all night: a stone tower, a timber smock or a post mill, with canvas sails, shutters or six sails, for code that feels homely and good-humoured, cheerfully at work whatever the weather. Its windows are lit at night. In decline its sails tear to bare frames and slow to a stop; then its cap lists on its curb.",
  params: windmillParams,
  build: (p, ctx) => buildWindmill(p, ctx),
});

export const rockArchParams = {
  form: t.choice("The opening the stone leaps over", {
    "a doorway": "A tall, narrow doorway through a fin of rock, a way through for one or two at a time, for code that feels shy and private, keeping to itself",
    "a gate": "A broad gate of stone, its opening nearly as wide as it is high, a road could pass under it, for code that feels open-handed and generous, welcoming whoever comes",
    "a great span": "A long, high span flung across open ground, thin against the sky, for code that feels daring and overreaching, stretched thin across a gap too wide for it",
  }),
  thickness: t.scale("How heavy its stone is: a slender ribbon of stone for code that feels delicate and finely balanced, stout and sure for code that feels sound and unfussy, massive and heavy for code that feels ponderous and overbuilt, far heavier than it needs to be", { "a slender ribbon of stone": 0.7, "stout and sure": 1, "massive and heavy": 1.35 }),
  stone: t.scale("How the weather has shaped it: worn smooth by wind and rain for code that feels softened and rounded by years of patient change, sharply cut along its joints for code that feels angular and abrupt, all hard edges", { "worn smooth by wind and rain": 0.15, "sharply cut along its joints": 1 }),
};

export const rockArch = primitive({
  id: "rock-arch@1",
  role: "Landmark",
  doc: "An arch of living rock the land made: a doorway, a gate or a great span standing over the way, for code that feels strange and wondrous, a shape no one would have planned, worn into being by slow forces. In decline its stacks lean apart and a crack opens across the span; the span falls and lies broken in the grass, leaving two stacks standing either side of the way.",
  params: rockArchParams,
  build: (p, ctx) => buildRockArch(p, ctx),
});

export const rotundaParams = {
  columns: t.choice("How many columns ring it", {
    six: "Six columns set wide apart, so the land and the light show between them, for code that feels airy and spare, more open space than stone",
    eight: "Eight columns evenly spaced, for code that feels prim and correct, every part matched by its twin",
    twelve: "Twelve columns close-set, a solemn colonnade all the way round, for code that feels solemn and crowded, many alike standing shoulder to shoulder",
  }),
  roof: t.choice("What it carries over its columns", {
    "a shallow dome": "A low, broad dome resting on the ring, quiet against the sky, for code that feels modest and quiet, keeping a low profile",
    "a high dome": "A tall dome raised on a drum and crowned by a small lantern, seen from far away, for code that feels proud and showy, dressed up for an occasion",
    "an open ring": "No roof at all: a ring of stone held high on the columns, open to the sky, for code that feels unfinished and open-ended, its top left open to whatever comes",
  }),
  steps: t.scale("How high its stepped base lifts it: a low plinth of two steps for code that feels approachable and down to earth, three broad steps for code that feels gracious and welcoming, a high podium of five steps for code that feels aloof and hard to approach", ROTUNDA_STEPS),
};

export const rotunda = primitive({
  id: "rotunda@1",
  role: "Landmark",
  doc: "A small round temple of stone, a garden folly: a ring of columns on a stepped base carrying a dome or an open ring, for code that feels graceful and contemplative, a quiet place set a little apart, made for pausing. In decline the dome falls in from its crown, then the columns topple outward one by one onto the steps.",
  params: rotundaParams,
  build: (p, ctx) => buildRotunda(p, ctx),
});

export const LANDMARK_PRIMITIVES = [lookoutTower, standingStones, greatTree, windmill, rockArch, rotunda];

/**
 * The proportion bands that each landmark primitive's build passes to `landmarkShape`, by primitive id. The great
 * tree has no entry, because its seed already sets every limb's length and turn.
 */
export const LANDMARK_SHAPES: Readonly<Record<string, Bands>> = {
  [lookoutTower.id]: TOWER_SHAPE,
  [standingStones.id]: STANDING_STONES_SHAPE,
  [windmill.id]: WINDMILL_SHAPE,
  [rockArch.id]: ROCK_ARCH_SHAPE,
  [rotunda.id]: ROTUNDA_SHAPE,
};
