// The proving ground's own looks: the blueprints its plan names for its sky,
// its lands, its buildings and landmarks and its trails, filled in by hand as
// Jev would compose them, since the proving ground is written by hand, not
// judged (`tools/proving.ts`). Only its generator reads them; the app reads
// the blueprints it writes into `proving-judged.json`.

import { type Blueprint, blueprintOf } from "@gaia/schema";

/** The sky: a fair spring morning. */
export const SKY: Blueprint = blueprintOf("world", {
  light: { use: "daylight@1", params: { path: "middling", warmth: "neutral", brush: "painterly", moon: "silver moon", stars: "many" } },
  sky: { use: "sky@1", params: { character: "powder blue", clouds: "fair-weather puffs", cover: "scattered" } },
  wind: { use: "wind@1", params: { strength: "breezy" } },
});

/** A land: a relief with its stored words and a ground cover, with every palette family native to it. */
const land = (relief: Blueprint["slots"][string], cover: string): Blueprint =>
  blueprintOf("biome", {
    relief,
    cover: { use: "ground-cover@1", params: { cover, length: "natural", wildflowers: "a scattering" } },
    natives: { use: "native-families@1", params: { families: [] } },
  });

/** Each land, by the name the plan gives it. */
export const LANDS: Readonly<Record<string, Blueprint>> = {
  "Brook valley": land({ use: "valley@1", params: { depth: "moderate", width: "open", run: "north-south", fall: "gentle", meander: "winding", stream: "brook" } }, "lush grass"),
  "Clover hills": land({ use: "rolling-hills@1", params: { height: "rolling", breadth: "moderately spaced", roughness: "softly uneven", grain: "round" } }, "clover meadow"),
  "Silver terraces": land({ use: "terraces@1", params: { form: "terraced hill", rise: "waist-high", climb: "a hillside", facing: "south", edge: "soft and grassy" } }, "silver grass"),
  "Mossy basin": land({ use: "basin@1", params: { depth: "a bowl", size: "medium", rim: "a soft rim", pond: true } }, "moss"),
  "Heather moor": land({ use: "meadow@1", params: { undulation: "softly undulating", tilt: "slightly tilted", facing: "east" } }, "heather"),
  "Meandering vale": land({ use: "valley@1", params: { depth: "shallow", width: "broad", run: "east-west", fall: "nearly level", meander: "strongly meandering", stream: "trickle" } }, "clover meadow"),
  "Golden dunes": land({ use: "dunes@1", params: { height: "low dunes", spacing: "even", wind: "from the west", wander: "wavering" } }, "golden steppe"),
  "Pond meadow": land({ use: "basin@1", params: { depth: "a shallow dip", size: "wide", rim: "melting into the land", pond: true } }, "lush grass"),
  "Broad downs": land({ use: "rolling-hills@1", params: { height: "gentle", breadth: "broad and sweeping", roughness: "smooth", grain: "diagonal" } }, "silver grass"),
  "Home lawn": land({ use: "meadow@1", params: { undulation: "flat as a lawn", tilt: "slightly tilted", facing: "south" } }, "lush grass"),
};

/** Each building, by the name the plan gives it. */
export const BUILDINGS: Readonly<Record<string, Blueprint>> = {
  "Thatched cottage": blueprintOf("structure", {
    footprint: { use: "cottage-plan@1", params: { massing: "a single block", shape: "long", size: "modest", storeys: "one storey", heights: "level", roof: "gabled", roofline: "steep", attachments: [], windows: "several", base: "on a stone plinth", character: "gently settled" } },
    body: { use: "timber-frame@1", params: { framing: "posts and rails", plaster: "hand-laid" } },
    roof: { use: "thatch@1", params: { thickness: "plump", overhang: "sheltering", chimney: "gable" } },
    openings: { use: "casements@1", params: { panes: "four panes", shutters: true, door: "hooded" } },
    ornaments: { use: "cottage-garden@1", params: { extras: ["flower boxes", "lantern", "woodpile"], walk: "stepping stones" } },
    palette: { use: "palette@1", params: { family: "spring-meadow", contrast: "balanced" } },
  }),
  "Stone croft": blueprintOf("structure", {
    footprint: { use: "cottage-plan@1", params: { massing: "a single block", shape: "snug", size: "modest", storeys: "one storey", heights: "level", roof: "hipped", roofline: "low and spreading", attachments: ["lean-to"], windows: "a few", base: "low on the ground", character: "trim and square" } },
    body: { use: "fieldstone@1", params: { stones: "mixed sizes", gables: "boards" } },
    roof: { use: "tiles@1", params: { covering: "slates", overhang: "neat and close", chimney: "ridge" } },
    openings: { use: "casements@1", params: { panes: "six panes", shutters: false, door: "plank" } },
    ornaments: { use: "cottage-garden@1", params: { extras: ["lantern", "woodpile"], walk: "flagstones" } },
    palette: { use: "palette@1", params: { family: "deep-forest", contrast: "balanced" } },
  }),
  "Storybook house": blueprintOf("structure", {
    footprint: { use: "cottage-plan@1", params: { massing: "a single block", shape: "gable-fronted", size: "modest", storeys: "two storeys", heights: "level", roof: "gabled", roofline: "tall and steep", attachments: ["turret", "porch"], windows: "several", base: "raised up steps", character: "crooked, like a storybook" } },
    body: { use: "timber-frame@1", params: { framing: "crossed braces", plaster: "lumpy and old" } },
    roof: { use: "tiles@1", params: { covering: "pantiles", overhang: "sheltering", chimney: "gable" } },
    openings: { use: "casements@1", params: { panes: "four panes", shutters: true, door: "arched" } },
    ornaments: { use: "cottage-garden@1", params: { extras: ["flower boxes", "fence", "lantern"], walk: "stepping stones" } },
    palette: { use: "palette@1", params: { family: "autumn-ember", contrast: "balanced" } },
  }),
  Watermill: blueprintOf("structure", {
    footprint: { use: "cottage-plan@1", params: { massing: "a long range", shape: "long", size: "roomy", storeys: "two storeys", heights: "stepped", roof: "gabled", roofline: "steep", attachments: [], windows: "several", base: "on a stone plinth", character: "gently settled" } },
    body: { use: "fieldstone@1", params: { stones: "mixed sizes", gables: "boards" } },
    roof: { use: "tiles@1", params: { covering: "shingles", overhang: "sheltering", chimney: "gable" } },
    feature: { use: "waterwheel@1", params: { wheel: "a great wheel", drive: "overshot" } },
    openings: { use: "casements@1", params: { panes: "six panes", shutters: true, door: "plank" } },
    ornaments: { use: "cottage-garden@1", params: { extras: ["lantern", "woodpile"], walk: "flagstones" } },
    palette: { use: "palette@1", params: { family: "teal-gold", contrast: "balanced" } },
  }),
  "Archive tower": blueprintOf("structure", {
    footprint: { use: "cottage-plan@1", params: { massing: "an L", shape: "snug", size: "modest", storeys: "two storeys", heights: "stepped", roof: "gabled", roofline: "tall and steep", attachments: [], windows: "several", base: "raised up steps", character: "gently settled" } },
    body: { use: "timber-frame@1", params: { framing: "close studding", plaster: "hand-laid" } },
    roof: { use: "tiles@1", params: { covering: "slates", overhang: "sheltering", chimney: "gable" } },
    feature: { use: "tower@1", params: { height: "tall", cap: "lantern" } },
    openings: { use: "casements@1", params: { panes: "six panes", shutters: false, door: "arched" } },
    ornaments: { use: "cottage-garden@1", params: { extras: ["flower boxes", "lantern"], walk: "flagstones" } },
    palette: { use: "palette@1", params: { family: "bluebell-wood", contrast: "balanced" } },
  }),
};

/** Each landmark, by the name the plan gives it. */
export const LANDMARKS: Readonly<Record<string, Blueprint>> = {
  "Lantern tower": blueprintOf("landmark", {
    form: { use: "lookout-tower@1", params: { height: "a lookout tower", plan: "round", profile: "tapering", galleries: "a gallery at the top", crown: "an open lantern room", masonry: "dressed blocks" } },
    palette: { use: "palette@1", params: { family: "spring-meadow", contrast: "balanced" } },
  }),
  "Stone ring": blueprintOf("landmark", {
    form: { use: "standing-stones@1", params: { arrangement: "ring", count: "a good many", height: "towering", lintels: true, centre: "a tall king stone", facets: "softly faceted" } },
    palette: { use: "palette@1", params: { family: "silver-birch", contrast: "balanced" } },
  }),
  "Great oak": blueprintOf("landmark", {
    form: { use: "great-tree@1", params: { form: "a spreading oak", size: "vast", age: "ancient, storm-broken and stag-headed", fullness: "dense and lush", bark: "deeply furrowed" } },
    motion: { use: "sway@1", params: { stiffness: "stiff", rhythm: "slow" } },
    palette: { use: "palette@1", params: { family: "deep-forest", contrast: "balanced" } },
  }),
  "Battlemented keep": blueprintOf("landmark", {
    form: { use: "lookout-tower@1", params: { height: "a tall tower", plan: "square", profile: "straight", galleries: "a gallery at the top", crown: "battlements", masonry: "great rough blocks" } },
    palette: { use: "palette@1", params: { family: "desert-sage", contrast: "balanced" } },
  }),
  "Great willow": blueprintOf("landmark", {
    form: { use: "great-tree@1", params: { form: "a great willow", size: "great", age: "old and broad", fullness: "full", bark: "gnarled and burred" } },
    motion: { use: "sway@1", params: { stiffness: "gently swaying", rhythm: "slow" } },
    palette: { use: "palette@1", params: { family: "lantern-dusk", contrast: "balanced" } },
  }),
};

/** Each trail's route, by the name the plan gives it. */
export const TRAILS: Readonly<Record<string, Blueprint>> = {
  "Worn footpath": blueprintOf("link", {
    route: { use: "trail@1", params: { width: "a path two could walk", wear: "well trodden", edging: "none", winding: "gently curving", crossing: "footbridge" } },
  }),
  "Stone-edged path": blueprintOf("link", {
    route: { use: "trail@1", params: { width: "a path two could walk", wear: "bare, beaten earth", edging: "stones", winding: "gently curving", crossing: "stepping stones" } },
  }),
  "Faint wandering track": blueprintOf("link", {
    route: { use: "trail@1", params: { width: "a narrow footpath", wear: "faint, half grassed over", edging: "none", winding: "meandering", crossing: "stepping stones" } },
  }),
};
