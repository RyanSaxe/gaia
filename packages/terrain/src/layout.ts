// A stand-in for the world layout: where each region's center sits and its
// ground level. The real layout comes from the directory tree.

import { rand } from "@gaia/schema";

export interface Site {
  readonly x: number;
  readonly z: number;
  readonly base: number;
}

/** Evenly spread, seeded sites: best-candidate sampling, then a few relaxation passes. */
export function layoutSites(seed: number, count: number, size: number): Site[] {
  const r = rand(seed);
  const half = size / 2;
  const margin = size * 0.18;
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    let best: [number, number] = [0, 0];
    let bestScore = -1;
    for (let c = 0; c < 24; c++) {
      const x = r.range(-half + margin, half - margin);
      const z = r.range(-half + margin, half - margin);
      const score = pts.length === 0 ? r.next() : Math.min(...pts.map(([px, pz]) => Math.hypot(px - x, pz - z)));
      if (score > bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
    pts.push(best);
  }
  // Lloyd relaxation on a coarse grid evens out region sizes.
  for (let pass = 0; pass < 4; pass++) {
    const sx = new Float64Array(count);
    const sz = new Float64Array(count);
    const n = new Float64Array(count);
    for (let gz = -half; gz <= half; gz += 8) {
      for (let gx = -half; gx <= half; gx += 8) {
        let k = 0;
        let d = Infinity;
        pts.forEach(([px, pz], i) => {
          const e = Math.hypot(px - gx, pz - gz);
          if (e < d) {
            d = e;
            k = i;
          }
        });
        sx[k] = (sx[k] as number) + gx;
        sz[k] = (sz[k] as number) + gz;
        n[k] = (n[k] as number) + 1;
      }
    }
    pts.forEach((p, i) => {
      const c = n[i] as number;
      if (c > 0) {
        p[0] = (sx[i] as number) / c;
        p[1] = (sz[i] as number) / c;
      }
    });
  }
  return pts.map(([x, z]) => ({ x, z, base: r.range(-2.5, 2.5) }));
}
