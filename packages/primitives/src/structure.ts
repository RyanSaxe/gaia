// Structure primitives: a building's plan, walls, roof, openings, dressing and
// feature. Every part builds from the one plan that `cottagePlan` lays out, so
// walls, roof, windows, flower boxes and a mill's wheel line up. Geometry is in
// ./geometry/building/.

import { primitive, t } from "@gaia/schema";
import { buildTower, buildWaterwheel } from "./geometry/building/features.ts";
import { buildBell, buildDovecote, buildForge, buildGranary, buildWell } from "./geometry/building/yard.ts";
import { buildGarden } from "./geometry/building/garden.ts";
import { layOutCottage } from "./geometry/building/layout.ts";
import { buildCasements } from "./geometry/building/openings.ts";
import { buildThatch, buildTiles } from "./geometry/building/roofs.ts";
import { buildFieldstone, buildTimberFrame } from "./geometry/building/walls.ts";

export const cottagePlanParams = {
  massing: t.choice("How the building's volumes are put together", {
    "a single block": "One simple block under one roof, for code that feels plain and self-contained",
    "an L": "A main range with a wing jutting out at one end, its gable facing outward, the door in the corner between them, for code that feels companionable and paired",
    "a T": "A main range with a gabled wing jutting from its middle, for code that feels balanced and formal, facing two ways at once",
    "a long range": "A long run of joined blocks in a line, each a little narrower than the last, like a farmhouse with its byre and barn, for code that feels patient, hardworking and long",
    "a cluster": "A main house with wings and outbuildings joined on all sides, added over the years, for code that feels rambling and gregarious, grown piece by piece",
  }),
  shape: t.choice("The main body's shape on the ground", {
    long: "A low range longer than it is deep, its door in the long side under the eaves, for code that feels easygoing and unhurried",
    snug: "A small, nearly square body, compact and cosy, for code that feels close and private",
    "gable-fronted": "A narrow body that faces you with its pointed gable, the door beneath the peak, for code that feels upright and alert",
  }),
  size: t.scale("How big the main body is", { tiny: 0.85, modest: 1, roomy: 1.15 }),
  storeys: t.scale("How many storeys the main body rises: one for code that feels humble and close to the ground, two for code that feels comfortable and settled, three for code that feels lofty and imposing", { "one storey": 1, "two storeys": 2, "three storeys": 3 }),
  heights: t.choice("How the joined parts' heights relate", {
    level: "Every part keeps the main body's storeys, under one eave line",
    stepped: "Each joined part stands a storey lower than the part it joins, so the roofs step down",
  }),
  roof: t.choice("The form of the roofs over the main body and its wings", {
    gabled: "Two slopes meeting at a ridge, with pointed gable walls at the ends",
    hipped: "Slopes on every side, so there are no gables and the roof sits low and calm",
    "half-hipped": "Gables whose tops are cut back into a small hip, like an old farmhouse",
  }),
  roofline: t.scale("How steep the roofs are", {
    "low and spreading": 33,
    steep: 45,
    "tall and steep": 54,
  }),
  attachments: t.set("What is built onto it", {
    porch: "A small gabled porch sheltering the door",
    "lean-to": "A low lean-to shed against a back or end wall, under one slope",
    turret: "A round turret at a corner, a storey taller, under a pointed cone",
  }),
  windows: t.scale("How many windows it has", { "a few": 1, several: 2, many: 3 }),
  base: t.scale("How high the floor sits on its stone base", {
    "low on the ground": 0.22,
    "on a stone plinth": 0.45,
    "raised up steps": 0.75,
  }),
  character: t.scale("How settled and crooked it is", {
    "trim and square": 0,
    "gently settled": 0.5,
    "crooked, like a storybook": 1,
  }),
};

export const cottagePlan = primitive({
  id: "cottage-plan@1",
  role: "Footprint",
  doc: "A building's plan: the volumes it is put together from, such as a single block, an L, a T, a long range or a cluster, with a porch, a lean-to or a turret, their storeys and roof forms, and where the door and windows go.",
  params: cottagePlanParams,
  build: (p, ctx) => layOutCottage(p, ctx),
});

export const timberFrameParams = {
  framing: t.choice("How the timber frame is laid out", {
    "posts and rails": "Upright posts with a rail at mid height, calm and simple",
    "crossed braces": "Posts with diagonal braces in the corners, like an old farmhouse",
    "close studding": "Many close upright timbers, tall and rhythmic",
  }),
  plaster: t.scale("How rough the plaster between the timbers is", {
    "smooth and fresh": 0.2,
    "hand-laid": 0.55,
    "lumpy and old": 1,
  }),
};

export const timberFrame = primitive({
  id: "timber-frame@1",
  role: "Walls",
  doc: "Whitewashed plaster walls held in a frame of dark timber beams, on a stone base, for code that feels lively and sociable, bright and a little busy.",
  params: timberFrameParams,
  build: (p, ctx, plan) => buildTimberFrame(p, ctx, plan),
});

export const fieldstoneParams = {
  stones: t.scale("The size of the stones", {
    "small and even": 0.32,
    "mixed sizes": 0.45,
    "big rounded boulders": 0.62,
  }),
  gables: t.choice("What fills the gable ends above the stone", {
    stone: "Stone all the way to the peak",
    boards: "Upright wooden boards under the peak",
  }),
};

export const fieldstone = primitive({
  id: "fieldstone@1",
  role: "Walls",
  doc: "Thick walls of rounded fieldstones set in pale lime mortar, for code that feels quiet and stubborn, weathered and slow to change.",
  params: fieldstoneParams,
  build: (p, ctx, plan) => buildFieldstone(p, ctx, plan),
});

export const chimneyField = t.choice("Where the chimney stands", {
  gable: "A stone stack climbing the outside of one gable end",
  ridge: "A stack rising through the ridge",
  none: "No chimney",
});

export const overhangField = t.scale("How far the roof reaches past the walls", {
  "neat and close": 0.3,
  sheltering: 0.6,
  "deep and low": 0.9,
});

export const thatchParams = {
  thickness: t.scale("How thick the thatch is", { trim: 0.28, plump: 0.42, "deep and soft": 0.58 }),
  overhang: overhangField,
  chimney: chimneyField,
};

export const thatch = primitive({
  id: "thatch@1",
  role: "Roof",
  doc: "A thick, soft thatched roof in layered courses with a rolled ridge and rounded eaves, for code that feels old, well loved and much used.",
  params: thatchParams,
  build: (p, ctx, plan) => buildThatch(p, ctx, plan),
});

export const tilesParams = {
  covering: t.choice("What the roof is covered with", {
    pantiles: "Rows of rounded clay pantiles",
    slates: "Thin, flat slates in neat courses",
    shingles: "Weathered wooden shingles",
  }),
  overhang: overhangField,
  chimney: chimneyField,
};

export const tiles = primitive({
  id: "tiles@1",
  role: "Roof",
  doc: "A gabled roof of tiles, slates or shingles in fine courses, with a gentle kick at the eaves, for code that feels new, crisp and sharp-edged.",
  params: tilesParams,
  build: (p, ctx, plan) => buildTiles(p, ctx, plan),
});

export const casementsParams = {
  panes: t.choice("How the windows are divided", {
    "four panes": "A cross of glazing bars: four panes",
    "six panes": "Six small panes",
    "one pane": "A single clear pane",
  }),
  shutters: t.flag("Do the windows have shutters?", "Painted shutters beside each window", "No shutters"),
  door: t.choice("The door's form", {
    plank: "A square-topped door of upright planks",
    arched: "A round-topped plank door, like a storybook",
    hooded: "A plank door under a small pitched hood",
  }),
};

export const casements = primitive({
  id: "casements@1",
  role: "Openings",
  doc: "Small-paned casement windows with stone sills and a wooden door with a step, lit by lamps at night.",
  params: casementsParams,
  build: (p, ctx, plan) => buildCasements(p, ctx, plan),
});

export const cottageGardenParams = {
  extras: t.set("What is placed around the cottage", {
    "flower boxes": "Boxes of flowers under the windows",
    lantern: "A lantern on a bracket by the door",
    woodpile: "Split logs stacked against a side wall",
    fence: "A low picket fence around the front garden",
  }),
  walk: t.choice("What leads to the door", {
    "stepping stones": "A few flat stepping stones through the grass",
    flagstones: "A narrow path of fitted flagstones",
  }),
};

export const cottageGarden = primitive({
  id: "cottage-garden@1",
  role: "Dressing",
  doc: "The small, lived-in things around a cottage: the walk to its door, flower boxes, a lantern, a woodpile, a fence.",
  params: cottageGardenParams,
  build: (p, ctx, plan) => buildGarden(p, ctx, plan),
});

export const waterwheelParams = {
  wheel: t.scale("How big the wheel is", { "a small wheel": 1.5, "a tall wheel": 1.9, "a great wheel": 2.35 }),
  drive: t.choice("How the water drives it", {
    overshot: "Fed from above by a wooden flume on trestles, so it turns away from the flume",
    undershot: "Pushed round at its foot by the race running under it",
  }),
};

export const waterwheel = primitive({
  id: "waterwheel@1",
  role: "Feature",
  doc: "A wooden waterwheel turning slowly in a stone-lined pit beside the house, for code that feels quaint, old-fashioned, unhurried and traditional. Its wheel slows to a stop as vitality falls.",
  params: waterwheelParams,
  // Jev is offered a waterwheel only where the place has running water.
  needs: ["running water"],
  build: (p, ctx, plan) => buildWaterwheel(p, ctx, plan),
});

export const towerParams = {
  height: t.scale("How far the tower rises above the house's roof", { "a storey above": 2.6, tall: 4.6, soaring: 7 }),
  cap: t.choice("What crowns it", {
    pyramid: "A steep four-sided cap with a finial",
    lantern: "An open lantern room whose lamp burns at night, under a small cap",
  }),
};

export const tower = primitive({
  id: "tower@1",
  role: "Feature",
  doc: "A tall square tower rising from the back corner of the house, its narrow windows lamplit at night, for code that feels dreamy, far-off and impractical. It crumbles from the top as vitality falls.",
  params: towerParams,
  build: (p, ctx, plan) => buildTower(p, ctx, plan),
});

export const dovecoteParams = {
  cote: t.choice("How the cote stands", {
    "a round stone cote": "A squat round dovecote of rough stone with a ledge round its middle, its conical roof crowned by a little open lantern",
    "a cote on a post": "A small painted dovecote raised on a tall post, rows of arched doorways under its pitched roof, each with a little ledge",
  }),
};

export const dovecote = primitive({
  id: "dovecote@1",
  role: "Feature",
  doc: "A dovecote beside the house, its little doorways and ledges open to the sky, for code that feels sociable and chatty, with visitors coming and going. Its roof rots open and it collapses as vitality falls.",
  params: dovecoteParams,
  build: (p, ctx, plan) => buildDovecote(p, ctx, plan),
});

export const wellParams = {
  head: t.choice("What stands over the well", {
    "a little roof": "A small shingled roof on two posts over the winch, the bucket hanging on its rope",
    "a sweep": "A long wooden pole balanced on a forked post, a stone weight at one end and the bucket at the other",
  }),
  width: t.scale("How wide the well is", { "a narrow well": 0.55, "a wide well": 0.75, "a great well": 0.95 }),
};

export const well = primitive({
  id: "well@1",
  role: "Feature",
  doc: "A round stone well in the yard, its water dark and still, for code that feels mysterious, deep and hard to see into. Its water sinks away and its bucket falls in as vitality drops.",
  params: wellParams,
  build: (p, ctx, plan) => buildWell(p, ctx, plan),
});

export const bellParams = {
  hanging: t.choice("What the bell hangs in", {
    "a stone arch": "Two stone piers joined by a round arch under a little gabled roof",
    "a timber frame": "Two frames of raked timber legs joined by the beam the bell hangs from, under a small shingled roof",
  }),
  bell: t.scale("How big the bell is", { "a small bell": 0.3, "a chapel bell": 0.42, "a great bell": 0.56 }),
};

export const bell = primitive({
  id: "bell@1",
  role: "Feature",
  doc: "A dark iron bell hung under a little roof beside the house, for code that feels brash, urgent and hard to ignore. It hangs askew and then disappears as vitality falls.",
  params: bellParams,
  build: (p, ctx, plan) => buildBell(p, ctx, plan),
});

export const forgeParams = {
  shelter: t.choice("What shelters the forge", {
    "an open shed": "An open-fronted shed of timber posts under one sloping roof, the hearth at its back",
    "open to the sky": "The hearth and its chimney standing alone in the yard, the anvil beside them",
  }),
  stack: t.scale("How tall its chimney stands", { "a short stack": 3.3, "a tall stack": 4.1, "a soaring stack": 5 }),
};

export const forge = primitive({
  id: "forge@1",
  role: "Feature",
  doc: "A smith's forge beside the house, its hearth glowing at dusk under a smoking chimney, for code that feels fierce, raw and rough-edged, still being worked into shape. It goes cold and its shelter falls in as vitality drops.",
  params: forgeParams,
  build: (p, ctx, plan) => buildForge(p, ctx, plan),
});

export const granaryParams = {
  size: t.scale("How much it holds", { "a small store": 1.9, "a granary": 2.4, "a great granary": 3 }),
  roof: t.choice("How it is roofed", {
    gabled: "Two slopes meeting at a ridge over boarded gables",
    hipped: "Slopes on every side meeting in a short ridge, low and snug",
  }),
};

export const granary = primitive({
  id: "granary@1",
  role: "Feature",
  doc: "A boarded granary raised on mushroom-shaped staddle stones beside the house, for code that feels thrifty and hoarding, keeping everything in case it is needed. It rots through and slumps off its stones as vitality falls.",
  params: granaryParams,
  build: (p, ctx, plan) => buildGranary(p, ctx, plan),
});

export const STRUCTURE_PRIMITIVES = [cottagePlan, timberFrame, fieldstone, thatch, tiles, casements, cottageGarden, waterwheel, tower, dovecote, well, bell, forge, granary];
