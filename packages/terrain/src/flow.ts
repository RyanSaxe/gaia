// How water moves: a stream runs down its solved waterline, faster where its
// channel narrows or its line falls, and a pond lies still. The renderer
// scrolls the surface along this flow and lets wading rings drift with it.

import { type SolvedStream, type Station, surfaceHalfWidth } from "./water.ts";
import type { Terrain } from "./world.ts";

export const FLOW = {
  /** Speed where a stream's channel is its typical size and its line is level, meters per second. */
  pace: 0.55,
  slowest: 0.2,
  fastest: 1.6,
  /** Each meter of fall per meter run adds this share of speed. */
  fall: 6,
} as const;

/** A velocity on the ground plane, meters per second. */
export interface Velocity {
  readonly x: number;
  readonly z: number;
}

const flows = new WeakMap<SolvedStream, Float32Array>();

const area = (s: Station): number => s.halfWidth * Math.max(s.depth, 0.05);

/**
 * The velocity at each station, as x, z pairs: along the stream toward its
 * lower end, where the same water through a narrower channel runs faster.
 */
export function streamFlow(stream: SolvedStream): Float32Array {
  const cached = flows.get(stream);
  if (cached !== undefined) return cached;
  const st = stream.stations;
  const n = st.length;
  const out = new Float32Array(n * 2);
  const typical = [...st].map(area).sort((a, b) => a - b)[Math.floor(n / 2)] ?? 1;
  const at = (i: number): Station => st[Math.max(0, Math.min(n - 1, i))] as Station;
  for (let i = 0; i < n; i++) {
    // Heading: the chord over a few stations, so a kink in the path never kinks the flow.
    const a = at(i - 2);
    const b = at(i + 2);
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run < 1e-6) continue;
    const slope = Math.max(0, a.level - b.level) / run;
    const speed = Math.min(FLOW.fastest, Math.max(FLOW.slowest, FLOW.pace * Math.sqrt(typical / area(at(i))) * (1 + FLOW.fall * slope)));
    out[i * 2] = ((b.x - a.x) / run) * speed;
    out[i * 2 + 1] = ((b.z - a.z) / run) * speed;
  }
  flows.set(stream, out);
  return out;
}

const STILL: Velocity = { x: 0, z: 0 };

/** The water's velocity at a point: the nearest stream's flow where its surface reaches, still elsewhere. */
export function flowAt(t: Terrain, x: number, z: number): Velocity {
  let best = Infinity;
  let vx = 0;
  let vz = 0;
  for (const stream of t.streams) {
    const st = stream.stations;
    const flow = streamFlow(stream);
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i] as Station;
      const b = st[i + 1] as Station;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len = abx * abx + abz * abz;
      const k = len > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len)) : 0;
      const d = Math.hypot(x - (a.x + abx * k), z - (a.z + abz * k));
      if (d >= best || d > surfaceHalfWidth(a) + (surfaceHalfWidth(b) - surfaceHalfWidth(a)) * k) continue;
      best = d;
      vx = (flow[i * 2] as number) + ((flow[i * 2 + 2] as number) - (flow[i * 2] as number)) * k;
      vz = (flow[i * 2 + 1] as number) + ((flow[i * 2 + 3] as number) - (flow[i * 2 + 1] as number)) * k;
    }
  }
  return best === Infinity ? STILL : { x: vx, z: vz };
}
