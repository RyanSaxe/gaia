// The shaders' wind field is a transcription of the CPU's (`gustAt` and
// `windDirAt` in @gaia/realize), so the gust that bends a plant in a test is
// the gust that bends it on screen. Tests cannot run a GPU, so this runs the
// GLSL text itself as JavaScript: its functions use only float arithmetic
// and built-ins that have a Math twin.

import { describe, expect, it } from "vitest";
import { gustAt, windDirAt } from "@gaia/realize";
import { WIND_FIELD_GLSL } from "@gaia/render";

type Vec2 = { x: number; y: number };
const BUILT_INS = {
  vec2: (x: number, y: number): Vec2 => ({ x, y }),
  smoothstep: (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  },
  fract: (x: number): number => x - Math.floor(x),
};

/** One GLSL function of WIND_FIELD_GLSL as a JavaScript function, with the chunk's constants in scope. */
function glslFunction(name: string): (...args: unknown[]) => unknown {
  const fn = new RegExp(`\\n\\w+ ${name}\\(([^)]*)\\) \\{\\n([\\s\\S]*?)\\n\\}`).exec(WIND_FIELD_GLSL);
  const mean = /const vec2 WIND_MEAN = vec2\(([^,]+), ([^)]+)\);/.exec(WIND_FIELD_GLSL);
  if (fn === null || mean === null) throw new Error(`no ${name} in WIND_FIELD_GLSL`);
  const params = (fn[1] as string).split(",").map((p) => p.trim().split(/\s+/)[1] as string);
  const body = (fn[2] as string).replace(/\b(?:float|vec2) (\w+) =/g, "const $1 =").replace(/\b(sin|cos|abs|floor|pow)\(/g, "Math.$1(");
  const run = new Function("WIND_MEAN", ...Object.keys(BUILT_INS), ...params, body);
  const constants = [BUILT_INS.vec2(Number(mean[1]), Number(mean[2])), ...Object.values(BUILT_INS)];
  return (...args) => run(...constants, ...args);
}

describe("WIND_FIELD_GLSL", () => {
  const gust = glslFunction("gustAt");
  const dir = glslFunction("windDir");
  const moments = Array.from({ length: 400 }, (_, i) => i * 7.31);
  const spots = [[0, 0], [37, -12], [-260, 410], [512, 180], [-90, -333]] as const;

  it("blows the same gusts as gustAt, everywhere and at every moment", () => {
    for (const [x, z] of spots) for (const t of moments) expect(gust({ x, y: z }, t)).toBeCloseTo(gustAt(x, z, t), 3);
  });

  it("turns with windDirAt", () => {
    for (const t of moments) {
      const d = dir(t) as Vec2;
      const [x, z] = windDirAt(t);
      expect(d.x).toBeCloseTo(x, 5);
      expect(d.y).toBeCloseTo(z, 5);
    }
  });
});
