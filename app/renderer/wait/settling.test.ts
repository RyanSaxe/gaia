import { describe, expect, it } from "vitest";
import { MAP_STYLE, healthField } from "../immersive/map-styles.ts";
import { SHOWN, type SettlingFile, type SettlingHealth, type SettlingLand, settlingHealth } from "./settling.ts";

/** A square of land 200 m across in 5 m cells: area "a" to the west, "b" to the east, both under the root. */
const N = 40;
const land: SettlingLand = {
  n: N,
  cell: 5,
  reach: 100,
  areas: ["", "a", "b"],
  nearest: Int16Array.from({ length: N * N }, (_, c) => (c % N < N / 2 ? 1 : 2)),
};
const center = (i: number): number => -land.reach + (i + 0.5) * land.cell;

/** Files scattered over both areas, with vitality from 0.1 to 0.95. */
const files: (SettlingFile & { readonly vitality: number })[] = Array.from({ length: 14 }, (_, k) => {
  const x = -80 + ((k * 37) % 160);
  return { path: `${x < 0 ? "a" : "b"}/f${k}.ts`, area: x < 0 ? "a" : "b", x, z: -75 + ((k * 53) % 150), reach: 6 + (k % 4) * 3, size: (6 + (k % 4) * 3) ** 2, vitality: [0.95, 0.2, 0.7, 0.45, 0.88, 0.1][k % 6] as number };
});

function build(): SettlingHealth {
  const steps = settlingHealth(land, files, MAP_STYLE.spread);
  for (;;) {
    const next = steps.next();
    if (next.done === true) return next.value;
  }
}

describe("health on the waiting sheet", () => {
  it("paints nothing before any health is settled, a cell in full only near the health it ends on, and once every file is, each cell is the field map's health in full", () => {
    const health = build();
    for (let c = 0; c < N * N; c++) expect(health.paint(c)).toBe(0);
    const final = build();
    final.settle(Object.fromEntries(files.map((f) => [f.path, f.vitality])));
    const range = Math.max(...files.map((f) => f.vitality)) - Math.min(...files.map((f) => f.vitality));
    for (const f of files) {
      health.settle({ [f.path]: f.vitality });
      for (let c = 0; c < N * N; c++) if (health.paint(c) === 1) expect(Math.abs(health.vitality(c) - final.vitality(c))).toBeLessThanOrEqual((1 - SHOWN[1]) * range + 1e-6);
    }
    const field = healthField(files, MAP_STYLE.spread);
    for (let c = 0; c < N * N; c++) {
      const area = land.areas[land.nearest[c] as number] as string;
      expect(health.paint(c)).toBe(1);
      expect(health.vitality(c)).toBeCloseTo(field(center(c % N), center(Math.floor(c / N)), health.ground(area) ?? Number.NaN), 4);
    }
  });
});
