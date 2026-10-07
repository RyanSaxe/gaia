// Wildflower primitives: one species shape per drift. Petals take the
// palette's bloom swatch, stems and leaves its stem swatch, and open faces
// its eye swatch. Geometry lives in ./geometry/wildflowers.ts.

import { primitive, t } from "@gaia/schema";
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

export const WILDFLOWER_PRIMITIVES = [daisies, cups, bells, spikes];
