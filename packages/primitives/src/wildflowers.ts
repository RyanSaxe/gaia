// Drift primitives: low plants among the grass, one species per drift. Each
// part uses one palette swatch: `bloom` for petals, `stem` for stems, leaves and
// fern fronds, `eye` for flower centers, and `cap`, `stalk` and `spot` for
// mushrooms. Geometry is in ./geometry/wildflowers.ts, ./geometry/ferns.ts and
// ./geometry/mushrooms.ts.

import { primitive, t } from "@gaia/schema";
import { buildFerns } from "./geometry/ferns.ts";
import { buildMushrooms } from "./geometry/mushrooms.ts";
import { buildDrift } from "./geometry/wildflowers.ts";

export const driftParams = {
  spread: t.scale("How wide the drift spreads: a small clump for code that feels small and self-contained, a patch for code that feels modest, a wide drift for code that feels spreading and generous", { "a small clump": 0.8, "a patch": 1.6, "a wide drift": 2.8 }),
  density: t.scale("How thickly the flowers grow: sparse for code that feels thin and scattered, a good showing for code that feels healthy, a thick carpet for code that feels lush and abundant", { sparse: 0.4, "a good showing": 0.75, "a thick carpet": 1.2 }),
  height: t.scale("How tall the flowers stand: low among the grass for code that feels humble and hidden, knee-high for code that feels ordinary, tall for code that feels prominent", { "low among the grass": 0.45, "knee-high": 0.7, tall: 1 }),
};

export const daisies = primitive({
  id: "daisies@1",
  role: "Drift",
  doc: "Open ray flowers with slim petals round a raised eye, like daisies or asters, for code that feels simple, sunny and plain to see.",
  params: driftParams,
  build: (p, ctx) => buildDrift("daisies", p, ctx),
});

export const cups = primitive({
  id: "cups@1",
  role: "Drift",
  doc: "Five rounded petals cupped round a small dark eye, like poppies or buttercups, for code that feels bright, bold and brief.",
  params: driftParams,
  build: (p, ctx) => buildDrift("cups", p, ctx),
});

export const bells = primitive({
  id: "bells@1",
  role: "Drift",
  doc: "Arching stems hung with nodding bells, like bluebells or harebells, for code that feels quiet, shy and private.",
  params: driftParams,
  build: (p, ctx) => buildDrift("bells", p, ctx),
});

export const spikes = primitive({
  id: "spikes@1",
  role: "Drift",
  doc: "Upright spires of small florets, like lupine or lavender, for code that feels proud, tidy and orderly.",
  params: driftParams,
  build: (p, ctx) => buildDrift("spikes", p, ctx),
});

export const fernParams = {
  fronds: t.scale("How many fronds rise from each crown: a few fronds for code that feels sparse, a full crown for code that feels whole, a crowded crown for code that feels thick and overgrown", { "a few fronds": 5, "a full crown": 9, "a crowded crown": 14 }),
  height: t.scale("How tall the fronds grow: low among the grass for code that feels hidden, knee-high for code that feels ordinary, waist-high for code that feels rank and luxuriant", { "low among the grass": 0.45, "knee-high": 0.7, "waist-high": 1.05 }),
  unroll: t.scale("How far the fronds have unrolled: still curled tight for code that feels new and not yet opened, half unfurled for code that feels still opening, fully open for code that feels grown and settled", { "still curled tight": 0.5, "half unfurled": 0.75, "fully open": 1 }),
};

export const ferns = primitive({
  id: "ferns@1",
  role: "Drift",
  doc: "Arching fronds of paired leaflets unrolling from a crown, with young crowns beside it, like a male fern or a lady fern, for code that feels ancient, hushed and shadowy.",
  params: fernParams,
  build: (p, ctx) => buildFerns(p, ctx),
});

export const mushroomParams = {
  grouping: t.choice("How the mushrooms grow together", {
    ring: "A ring of caps round an empty middle, like a fairy ring, for code that feels uncanny and enchanted",
    cluster: "A tight huddle springing from one spot, the caps leaning out from each other, for code that feels clannish and close",
    scatter: "A few caps dotted loosely about, each keeping its distance, for code that feels solitary and spread thin",
  }),
  cap: t.choice("The shape of each cap", {
    domed: "Round domed caps, like a toadstool's, for code that feels storybook and homely",
    flat: "Broad caps spread nearly flat, like a parasol, for code that feels sheltering and open",
    pointed: "Slender pointed caps, like a pixie's hat, for code that feels mischievous and odd",
  }),
  // Real mushroom heights in meters. The renderer's mushrooms group grows short turf round each drift, so they stay visible.
  height: t.scale("How tall the mushrooms stand: barely above the moss for code that feels hidden underfoot, ankle-high for code that feels small but present, a hand high for code that feels quietly productive", { "barely above the moss": 0.09, "ankle-high": 0.13, "a hand high": 0.19 }),
};

export const mushrooms = primitive({
  id: "mushrooms@1",
  role: "Drift",
  doc: "Capped mushrooms on pale stalks standing up out of the grass, a few young buttons among them, for code that feels hidden, strange and busy out of sight.",
  params: mushroomParams,
  build: (p, ctx) => buildMushrooms(p, ctx),
});

export const WILDFLOWER_PRIMITIVES = [daisies, cups, bells, spikes, ferns, mushrooms];
