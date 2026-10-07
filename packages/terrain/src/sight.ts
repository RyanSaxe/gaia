// How far a person standing on the ground can see the ground. A ray marches
// outward along each bearing; a sample is visible when it rises above every
// nearer sample's line of sight. The farthest visible sample per bearing is
// where that direction's view of the land ends.

import { type Lattice, heightAt } from "./lattice.ts";

export const EYE_HEIGHT = 1.6;

export interface Sightlines {
  /** Farthest visible ground over every bearing, meters. */
  readonly max: number;
  /** Median over bearings of the farthest visible ground, meters. */
  readonly median: number;
  /** Farthest visible ground per bearing, meters. */
  readonly bearings: Float32Array;
}

export function sightlines(l: Lattice, x: number, z: number, eye = EYE_HEIGHT, count = 72, step = 1): Sightlines {
  const eyeY = heightAt(l, x, z) + eye;
  const edge = -l.origin;
  const bearings = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    const a = (b / count) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let horizon = -Infinity;
    let farthest = 0;
    for (let d = step; ; d += step) {
      const px = x + dx * d;
      const pz = z + dz * d;
      if (Math.abs(px) > edge || Math.abs(pz) > edge) break;
      const tan = (heightAt(l, px, pz) - eyeY) / d;
      if (tan >= horizon) {
        horizon = tan;
        farthest = d;
      }
    }
    bearings[b] = farthest;
  }
  const sorted = [...bearings].sort((p, q) => p - q);
  return { max: sorted[sorted.length - 1] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0, bearings };
}
