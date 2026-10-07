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

/** Hand-filled world blueprints: the words Jev might choose for six different repositories. */
const worldOf = (
  light: Record<string, string>,
  sky: Record<string, string>,
  season: Record<string, string>,
  air: Record<string, string>,
  ground: Record<string, string>,
  drift: Record<string, string> | null,
  wind: string,
): Blueprint =>
  identify("world", {
    light: { use: "daylight@1", params: light },
    sky: { use: "sky@1", params: sky },
    season: { use: "season@1", params: season },
    air: { use: "air@1", params: air },
    ground: { use: "ground-cover@1", params: ground },
    ...(drift === null ? {} : { drift: { use: "drift@1", params: drift } }),
    wind: { use: "wind@1", params: { strength: wind } },
  });

export const WORLD_PRESETS: readonly Preset[] = [
  {
    name: "Meadow morning",
    blueprint: worldOf(
      { hour: "morning", path: "middling", warmth: "neutral", brush: "painterly" },
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
    blueprint: worldOf(
      { hour: "golden hour", path: "middling", warmth: "warm", brush: "soft watercolor" },
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
    blueprint: worldOf(
      { hour: "morning", path: "low, like winter", warmth: "cool", brush: "soft watercolor" },
      { character: "watercolor wash", clouds: "mackerel dapples", cover: "many, but with blue between" },
      { season: "first frost", strength: "in full" },
      { air: "morning mist", distance: "softened distance" },
      { cover: "moss", length: "natural", wildflowers: "none" },
      { form: "motes of light", amount: "a few" },
      "still air",
    ),
  },
  {
    name: "Firefly dusk",
    blueprint: worldOf(
      { hour: "dusk", path: "middling", warmth: "warm", brush: "painterly" },
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
    blueprint: worldOf(
      { hour: "afternoon", path: "high, like midsummer", warmth: "neutral", brush: "bold gouache" },
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
    blueprint: worldOf(
      { hour: "dawn", path: "low, like winter", warmth: "neutral", brush: "painterly" },
      { character: "cobalt", clouds: "low drifting banks", cover: "many, but with blue between" },
      { season: "deep autumn", strength: "in full" },
      { air: "clear", distance: "softened distance" },
      { cover: "heather", length: "natural", wildflowers: "a scattering" },
      { form: "falling leaves", amount: "some" },
      "gusty",
    ),
  },
];
