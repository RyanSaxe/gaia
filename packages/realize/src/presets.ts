// The hand-filled blueprints each of Jev's forms for a tree, a bush, a stone
// or flowers names (`FORMS` in app/renderer/terrain/looks.ts): the stored
// words, as Jev would have answered them. IDs come from content, like the
// planner's.

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
      crown: { use: "leaf-clumps@1", params: { shape: "round", leaf: "blossom", size: "medium", fullness: "full" } },
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
      crown: { use: "leaf-clumps@1", params: { shape: "round", leaf: "lobed", size: "large", fullness: "dense and lush" } },
      motion: { use: "sway@1", params: { stiffness: "gently swaying", rhythm: "gentle" } },
      palette: { use: "palette@1", params: { family: "autumn-ember", contrast: "balanced" } },
    }),
  },
];

const shrub = (
  form: Record<string, string>,
  crown: Record<string, string>,
  family: string,
  bloom: Record<string, string> | null = null,
): Blueprint =>
  identify("flora", {
    form: { use: "thicket@1", params: form },
    bark: { use: "bark@1", params: { roughness: "smooth" } },
    crown: { use: "leaf-mound@1", params: crown },
    ...(bloom === null ? {} : { bloom: { use: "blossoms@1", params: bloom } }),
    motion: { use: "sway@1", params: { stiffness: "stiff", rhythm: "gentle" } },
    palette: { use: "palette@1", params: { family, contrast: "balanced" } },
  });

/** Bushes are flora too: a thicket frame under a mound of leaves. */
export const SHRUB_PRESETS: readonly Preset[] = [
  { name: "Box mound", blueprint: shrub({ habit: "mound", stems: "several stems", stature: "waist-high" }, { leaves: "glossy", fullness: "dense and clipped" }, "deep-forest") },
  {
    name: "Blueberry",
    blueprint: shrub({ habit: "mound", stems: "several stems", stature: "waist-high" }, { leaves: "rounded", fullness: "full" }, "bluebell-wood", { form: "berries", count: "a scattered few" }),
  },
  {
    name: "Rhododendron",
    blueprint: shrub({ habit: "spreading", stems: "a dense tangle", stature: "waist-high" }, { leaves: "glossy", fullness: "full" }, "bluebell-wood", { form: "petals", count: "plenty" }),
  },
  { name: "Feather shrub", blueprint: shrub({ habit: "vase", stems: "several stems", stature: "head-high" }, { leaves: "feathery", fullness: "full" }, "silver-birch") },
];

const rockOf = (use: string, params: Record<string, string>, moss: Record<string, string> | null, family: string): Blueprint =>
  identify("rock", {
    form: { use: use as `${string}@${number}`, params },
    ...(moss === null ? {} : { moss: { use: "moss@1", params: moss } }),
    palette: { use: "palette@1", params: { family, contrast: "balanced" } },
  });

export const ROCK_PRESETS: readonly Preset[] = [
  {
    name: "Mossy boulder",
    blueprint: rockOf("boulder@1", { size: "waist-high", shape: "round", facets: "softly faceted" }, { cover: "a cap on top", growth: "velvet" }, "spring-meadow"),
  },
  {
    name: "Standing stone",
    blueprint: rockOf("boulder@1", { size: "taller than a person", shape: "egg", facets: "sharply faceted" }, { cover: "a few patches", growth: "lichen" }, "deep-forest"),
  },
  {
    name: "Bench stone",
    blueprint: rockOf("flat-stone@1", { size: "a bench", top: "level", facets: "softly faceted" }, { cover: "a few patches", growth: "cushions" }, "spring-meadow"),
  },
  {
    name: "Stone family",
    blueprint: rockOf("stone-cluster@1", { count: "several", size: "waist-high", facets: "softly faceted" }, { cover: "a cap on top", growth: "velvet" }, "teal-gold"),
  },
];

const flowersOf = (use: string, params: Record<string, string>, family: string, stiffness = "supple"): Blueprint =>
  identify("wildflowers", {
    drift: { use: use as `${string}@${number}`, params },
    motion: { use: "sway@1", params: { stiffness, rhythm: "gentle" } },
    palette: { use: "palette@1", params: { family, contrast: "balanced" } },
  });

export const FLOWER_PRESETS: readonly Preset[] = [
  { name: "Daisies", blueprint: flowersOf("daisies@1", { spread: "a wide drift", density: "a good showing", height: "knee-high" }, "spring-meadow") },
  { name: "Bluebells", blueprint: flowersOf("bells@1", { spread: "a patch", density: "a thick carpet", height: "knee-high" }, "bluebell-wood") },
  { name: "Ferns", blueprint: flowersOf("ferns@1", { fronds: "a full crown", height: "knee-high", unroll: "fully open" }, "deep-forest", "gently swaying") },
];

/** Mushrooms stand apart from the flowers: too low to show over the grass, the understory keeps a patch of short turf round each drift. */
export const MUSHROOM_PRESETS: readonly Preset[] = [
  { name: "Mushrooms", blueprint: flowersOf("mushrooms@1", { grouping: "ring", cap: "domed", height: "ankle-high" }, "silver-birch", "stiff") },
];
