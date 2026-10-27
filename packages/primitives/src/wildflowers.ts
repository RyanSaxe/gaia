// Drift primitives: the low plants of the grass, one species shape per
// drift. Petals take the palette's bloom swatch, stems, leaves and fern
// fronds its stem swatch, and open faces its eye swatch; mushrooms take its
// cap and stalk swatches. Geometry lives in ./geometry/wildflowers.ts,
// ./geometry/ferns.ts and ./geometry/mushrooms.ts.

import { primitive, t } from "@gaia/schema";
import { buildFerns } from "./geometry/ferns.ts";
import { buildMushrooms } from "./geometry/mushrooms.ts";
import { buildDrift } from "./geometry/wildflowers.ts";

export const driftParams = {
  spread: t.scale("How wide the drift spreads", { "a small clump": 0.8, "a patch": 1.6, "a wide drift": 2.8 }),
  density: t.scale("How thickly the flowers grow", { sparse: 0.4, "a good showing": 0.75, "a thick carpet": 1.2 }),
  height: t.scale("How tall the flowers stand", { "low among the grass": 0.45, "knee-high": 0.7, tall: 1 }),
};

export const daisies = primitive({
  id: "daisies@1",
  role: "Drift",
  doc: "Open ray flowers with slim petals round a raised eye, like daisies or asters.",
  params: driftParams,
  build: (p, ctx) => buildDrift("daisies", p, ctx),
});

export const cups = primitive({
  id: "cups@1",
  role: "Drift",
  doc: "Five rounded petals cupped round a small dark eye, like poppies or buttercups.",
  params: driftParams,
  build: (p, ctx) => buildDrift("cups", p, ctx),
});

export const bells = primitive({
  id: "bells@1",
  role: "Drift",
  doc: "Arching stems hung with nodding bells, like bluebells or harebells.",
  params: driftParams,
  build: (p, ctx) => buildDrift("bells", p, ctx),
});

export const spikes = primitive({
  id: "spikes@1",
  role: "Drift",
  doc: "Upright spires of small florets, like lupine or lavender.",
  params: driftParams,
  build: (p, ctx) => buildDrift("spikes", p, ctx),
});

export const fernParams = {
  fronds: t.scale("How many fronds rise from each crown", { "a few fronds": 5, "a full crown": 9, "a crowded crown": 14 }),
  height: t.scale("How tall the fronds grow", { "low among the grass": 0.45, "knee-high": 0.7, "waist-high": 1.05 }),
  unroll: t.scale("How far the fronds have unrolled", { "still curled tight": 0.5, "half unfurled": 0.75, "fully open": 1 }),
};

export const ferns = primitive({
  id: "ferns@1",
  role: "Drift",
  doc: "Arching fronds of paired leaflets unrolling from a crown, with young crowns beside it, like a male fern or a lady fern.",
  params: fernParams,
  build: (p, ctx) => buildFerns(p, ctx),
});

export const mushroomParams = {
  grouping: t.choice("How the mushrooms grow together", {
    ring: "A ring of caps round an empty middle, like a fairy ring",
    cluster: "A tight huddle springing from one spot, the caps leaning out from each other",
    scatter: "A few caps dotted loosely about, each keeping its distance",
  }),
  cap: t.choice("The shape of each cap", {
    domed: "Round domed caps, like a toadstool's",
    flat: "Broad caps spread nearly flat, like a parasol",
    pointed: "Slender pointed caps, like a pixie's hat",
  }),
  // Natural sizes: the world keeps a patch of short turf round a drift of them (the understory's mushrooms group), so they show.
  height: t.scale("How tall the mushrooms stand", { "barely above the moss": 0.09, "ankle-high": 0.13, "a hand high": 0.19 }),
};

export const mushrooms = primitive({
  id: "mushrooms@1",
  role: "Drift",
  doc: "Capped mushrooms on pale stalks standing up out of the grass, a few young buttons among them.",
  params: mushroomParams,
  build: (p, ctx) => buildMushrooms(p, ctx),
});

export const WILDFLOWER_PRIMITIVES = [daisies, cups, bells, spikes, ferns, mushrooms];
