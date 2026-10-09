// The wind field behaves like air: mostly a light breeze that never falls
// still and seldom blows hard, gusts that come at irregular intervals, most
// of them mild and a few strong, each one travelling downwind rather than
// rising everywhere at once.

import { describe, expect, it } from "vitest";
import { WIND_FIELD, gustAt, windDirAt } from "@gaia/realize";

const STEP = 0.1;
/** The field at (x, z), every STEP seconds for `seconds`. */
const series = (x: number, z: number, seconds: number): number[] => Array.from({ length: Math.round(seconds / STEP) }, (_, i) => gustAt(x, z, i * STEP));
/** The peaks a person would call gusts: local maxima that rise well above the breeze. */
const gusts = (s: readonly number[]): { at: number; peak: number }[] =>
  s.flatMap((v, i) => (i > 0 && i < s.length - 1 && v > (s[i - 1] as number) && v >= (s[i + 1] as number) && v > 0.35 ? [{ at: i * STEP, peak: v }] : []));
const median = (a: readonly number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] as number;
const SPOTS = [[0, 0], [137, -52], [-300, 220], [40, 400]] as const;

describe("the wind field", () => {
  it("is mostly a light breeze that never falls still, with irregular gusts, most mild and some strong", () => {
    for (const [x, z] of SPOTS) {
      const s = series(x, z, 1200);
      expect(Math.min(...s)).toBeGreaterThan(0.08);
      expect(Math.max(...s)).toBeLessThanOrEqual(1);
      expect(s.filter((v) => v > 0.6).length / s.length).toBeLessThan(0.1);
      const g = gusts(s);
      const intervals = g.slice(1).map((p, i) => p.at - (g[i] as { at: number }).at);
      expect(Math.max(...intervals)).toBeGreaterThan(3 * Math.min(...intervals));
      expect(median(g.map((p) => p.peak))).toBeLessThan(0.6);
      expect(Math.max(...g.map((p) => p.peak))).toBeGreaterThan(0.85);
    }
  });

  it("carries each gust downwind at its speed, and never gusts in step across the wind", () => {
    const [dx, dz] = WIND_FIELD.dir;
    const correlation = (a: readonly number[], b: readonly number[]): number => {
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      let ab = 0;
      let aa = 0;
      let bb = 0;
      for (let i = 0; i < a.length; i++) {
        ab += ((a[i] as number) - ma) * ((b[i] as number) - mb);
        aa += ((a[i] as number) - ma) ** 2;
        bb += ((b[i] as number) - mb) ** 2;
      }
      return ab / Math.sqrt(aa * bb);
    };
    const here = series(0, 0, 600);
    const downwind = series(30 * dx, 30 * dz, 600);
    // The lag at which the spot 30 m downwind best repeats this one.
    let best = 0;
    for (let lag = 1; lag < 120; lag++) if (correlation(here.slice(0, -lag), downwind.slice(lag)) > correlation(here.slice(0, -best || undefined), downwind.slice(best))) best = lag;
    expect(best * STEP).toBeCloseTo(30 / WIND_FIELD.gust.speed, 0);
    expect(correlation(here, series(-250 * dz, 250 * dx, 600))).toBeLessThan(0.5);
  });

  it("wanders a few degrees about its direction, slowly", () => {
    const [mx, mz] = WIND_FIELD.dir;
    let last = windDirAt(0);
    for (let t = 0; t < 3600; t += 0.5) {
      const [x, z] = windDirAt(t);
      expect(Math.acos(Math.min(1, x * mx + z * mz))).toBeLessThan(0.15);
      expect(Math.acos(Math.min(1, x * last[0] + z * last[1]))).toBeLessThan(0.01);
      last = [x, z];
    }
  });
});
