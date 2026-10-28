// What a tree's, a stone's, a bush's or a drift's map mark is drawn from (`immersive/plant-marks.ts`), measured once
// from its build, so every copy of the build shares it.

import type { Blueprint, Palette } from "@gaia/schema";
import type { Realized } from "@gaia/realize";

/**
 * A build as its map mark is drawn: its blueprint and colors, how tall it stands, how far it reaches from its middle
 * and how high its lowest leaves hang (0 for what bears none), meters at scale 1.
 */
export interface PlantMark {
  readonly blueprint: Blueprint;
  readonly palette: Palette;
  readonly height: number;
  readonly radius: number;
  readonly crown: number;
}

/** A build's map mark, measured from what of it stands above the ground. */
export function markOf(blueprint: Blueprint, plant: Realized): PlantMark {
  let height = 0.05;
  let radius = 0.1;
  let crown = Number.POSITIVE_INFINITY;
  for (const part of plant.parts) {
    const p = part.positions;
    for (let k = 0; k < p.length; k += 3) {
      const y = p[k + 1] as number;
      if (y < -0.02) continue;
      height = Math.max(height, y);
      radius = Math.max(radius, Math.hypot(p[k] as number, p[k + 2] as number));
      if (part.swatch === "leaf") crown = Math.min(crown, y);
    }
  }
  return { blueprint, palette: plant.palette, height, radius, crown: Number.isFinite(crown) ? Math.max(0, crown) : 0 };
}
