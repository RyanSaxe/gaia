// Hand-filled flora blueprints for the component lab: the stored words, as
// Jev would have answered them. IDs come from content, like the planner's.

import { type Blueprint, blueprintOf as identify } from "@gaia/schema";

export interface Preset {
  readonly name: string;
  readonly blueprint: Blueprint;
}

export const FLORA_PRESETS: readonly Preset[] = [
  {
    name: "Lantern willow",
    blueprint: identify("flora", {
      form: {
        use: "branching@1",
        params: { habit: "weeping", density: "moderate branching", spread: "open", stature: "balanced" },
      },
      bark: { use: "bark@1", params: { roughness: "lightly textured" } },
      crown: { use: "leaf-strands@1", params: { length: "long, trailing", fullness: "dense curtain" } },
      bloom: { use: "blossoms@1", params: { form: "pods", count: "plenty" } },
      motion: { use: "sway@1", params: { stiffness: "supple", rhythm: "slow" } },
      palette: { use: "palette@1", params: { family: "lantern-dusk", contrast: "balanced" } },
    }),
  },
  {
    name: "Fir",
    blueprint: identify("flora", {
      form: { use: "spire@1", params: { whorls: "many close rings", droop: "drooping at the tips", stature: "classic cone" } },
      bark: { use: "bark@1", params: { roughness: "deeply furrowed" } },
      crown: { use: "needles@1", params: { length: "medium", fullness: "dense and dark" } },
      motion: { use: "sway@1", params: { stiffness: "stiff", rhythm: "gentle" } },
      palette: { use: "palette@1", params: { family: "deep-forest", contrast: "balanced" } },
    }),
  },
  {
    name: "Cherry",
    blueprint: identify("flora", {
      form: {
        use: "branching@1",
        params: { habit: "spreading", density: "moderate branching", spread: "wide", stature: "squat and broad" },
      },
      bark: { use: "bark@1", params: { roughness: "smooth" } },
      crown: { use: "leaf-clumps@1", params: { shape: "round", size: "medium", fullness: "full" } },
      bloom: { use: "blossoms@1", params: { form: "petals", count: "covered in them" } },
      motion: { use: "sway@1", params: { stiffness: "gently swaying", rhythm: "gentle" } },
      palette: { use: "palette@1", params: { family: "cherry-blossom", contrast: "balanced" } },
    }),
  },
  {
    name: "Autumn maple",
    blueprint: identify("flora", {
      form: {
        use: "branching@1",
        params: { habit: "upright", density: "dense, fine twigwork", spread: "open", stature: "balanced" },
      },
      bark: { use: "bark@1", params: { roughness: "lightly textured" } },
      crown: { use: "leaf-clumps@1", params: { shape: "round", size: "large", fullness: "dense and lush" } },
      motion: { use: "sway@1", params: { stiffness: "gently swaying", rhythm: "gentle" } },
      palette: { use: "palette@1", params: { family: "autumn-ember", contrast: "balanced" } },
    }),
  },
];

/** Hand-filled structure blueprints: cottages Jev might choose for central files. */
export const STRUCTURE_PRESETS: readonly Preset[] = [
  {
    name: "Thatched cottage",
    blueprint: identify("structure", {
      footprint: {
        use: "cottage-plan@1",
        params: { shape: "long", size: "modest", roofline: "steep", windows: "several", base: "on a stone plinth", character: "gently settled" },
      },
      body: { use: "timber-frame@1", params: { framing: "posts and rails", plaster: "hand-laid" } },
      roof: { use: "thatch@1", params: { thickness: "plump", overhang: "sheltering", chimney: "gable" } },
      openings: { use: "casements@1", params: { panes: "four panes", shutters: true, door: "hooded" } },
      ornaments: { use: "cottage-garden@1", params: { extras: ["flower boxes", "lantern", "woodpile"], walk: "stepping stones" } },
      palette: { use: "palette@1", params: { family: "spring-meadow", contrast: "balanced" } },
    }),
  },
  {
    name: "Stone croft",
    blueprint: identify("structure", {
      footprint: {
        use: "cottage-plan@1",
        params: { shape: "snug", size: "modest", roofline: "low and spreading", windows: "a few", base: "low on the ground", character: "trim and square" },
      },
      body: { use: "fieldstone@1", params: { stones: "mixed sizes", gables: "boards" } },
      roof: { use: "tiles@1", params: { covering: "slates", overhang: "neat and close", chimney: "ridge" } },
      openings: { use: "casements@1", params: { panes: "six panes", shutters: false, door: "plank" } },
      ornaments: { use: "cottage-garden@1", params: { extras: ["lantern", "woodpile"], walk: "flagstones" } },
      palette: { use: "palette@1", params: { family: "deep-forest", contrast: "balanced" } },
    }),
  },
  {
    name: "Storybook house",
    blueprint: identify("structure", {
      footprint: {
        use: "cottage-plan@1",
        params: { shape: "gable-fronted", size: "modest", roofline: "tall and steep", windows: "several", base: "raised up steps", character: "crooked, like a storybook" },
      },
      body: { use: "timber-frame@1", params: { framing: "crossed braces", plaster: "lumpy and old" } },
      roof: { use: "tiles@1", params: { covering: "pantiles", overhang: "sheltering", chimney: "gable" } },
      openings: { use: "casements@1", params: { panes: "four panes", shutters: true, door: "arched" } },
      ornaments: { use: "cottage-garden@1", params: { extras: ["flower boxes", "fence", "lantern"], walk: "stepping stones" } },
      palette: { use: "palette@1", params: { family: "autumn-ember", contrast: "balanced" } },
    }),
  },
];

/** A named world for the lab: the shared world blueprint and the biome of the region the lab shows. */
export interface WorldPreset {
  readonly name: string;
  readonly world: Blueprint;
  readonly biome: Blueprint;
}

/** Hand-filled blueprints: the words Jev might choose for six different repositories. */
const worldOf = (
  light: Record<string, string>,
  sky: Record<string, string>,
  season: Record<string, string>,
  air: Record<string, string>,
  ground: Record<string, string>,
  drift: Record<string, string> | null,
  wind: string,
): Omit<WorldPreset, "name"> => ({
  world: identify("world", {
    light: { use: "daylight@1", params: light },
    sky: { use: "sky@1", params: sky },
    season: { use: "season@1", params: season },
    wind: { use: "wind@1", params: { strength: wind } },
  }),
  biome: identify("biome", {
    relief: { use: "meadow@1", params: { undulation: "softly undulating", tilt: "level", facing: "south" } },
    cover: { use: "ground-cover@1", params: ground },
    air: { use: "air@1", params: air },
    ...(drift === null ? {} : { accents: { use: "drift@1", params: drift } }),
    natives: { use: "native-families@1", params: { families: [] } },
  }),
});

export const WORLD_PRESETS: readonly WorldPreset[] = [
  {
    name: "Meadow morning",
    ...worldOf(
      { path: "middling", warmth: "neutral", brush: "painterly", moon: "silver moon", stars: "many" },
      { character: "powder blue", clouds: "fair-weather puffs", cover: "scattered" },
      { season: "spring", strength: "clearly" },
      { air: "clear", distance: "for miles" },
      { cover: "lush grass", length: "natural", wildflowers: "a scattering" },
      { form: "drifting petals", amount: "a few" },
      "breezy",
    ),
  },
  {
    name: "Amber steppe",
    ...worldOf(
      { path: "middling", warmth: "warm", brush: "soft watercolor", moon: "amber harvest moon", stars: "a scattered few" },
      { character: "apricot", clouds: "cirrus streaks", cover: "scattered" },
      { season: "early autumn", strength: "clearly" },
      { air: "hazy gold", distance: "softened distance" },
      { cover: "golden steppe", length: "tall and unkempt", wildflowers: "none" },
      { form: "dandelion seeds", amount: "some" },
      "breezy",
    ),
  },
  {
    name: "Frost hollow",
    ...worldOf(
      { path: "low, like winter", warmth: "cool", brush: "soft watercolor", moon: "thin pale crescent", stars: "a river of stars" },
      { character: "watercolor wash", clouds: "low drifting banks", cover: "many, but with blue between" },
      { season: "first frost", strength: "in full" },
      { air: "morning mist", distance: "softened distance" },
      { cover: "moss", length: "natural", wildflowers: "none" },
      { form: "motes of light", amount: "a few" },
      "still air",
    ),
  },
  {
    name: "Firefly dusk",
    ...worldOf(
      { path: "middling", warmth: "warm", brush: "painterly", moon: "silver moon", stars: "a river of stars" },
      { character: "lavender", clouds: "low drifting banks", cover: "scattered" },
      { season: "high summer", strength: "clearly" },
      { air: "blue haze", distance: "softened distance" },
      { cover: "clover meadow", length: "natural", wildflowers: "drifts of them" },
      { form: "fireflies at dusk", amount: "many" },
      "light airs",
    ),
  },
  {
    name: "Monsoon terraces",
    ...worldOf(
      { path: "high, like midsummer", warmth: "neutral", brush: "bold gouache", moon: "amber harvest moon", stars: "many" },
      { character: "teal lagoon", clouds: "towering cumulus", cover: "many, but with blue between" },
      { season: "monsoon green", strength: "in full" },
      { air: "blue haze", distance: "for miles" },
      { cover: "silver grass", length: "tall and unkempt", wildflowers: "none" },
      null,
      "gusty",
    ),
  },
  {
    name: "Heather moor",
    ...worldOf(
      { path: "low, like winter", warmth: "neutral", brush: "painterly", moon: "thin pale crescent", stars: "many" },
      { character: "cobalt", clouds: "low drifting banks", cover: "many, but with blue between" },
      { season: "deep autumn", strength: "in full" },
      { air: "clear", distance: "softened distance" },
      { cover: "heather", length: "natural", wildflowers: "a scattering" },
      { form: "falling leaves", amount: "some" },
      "gusty",
    ),
  },
];
