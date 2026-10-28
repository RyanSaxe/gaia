// Builds trail structures: a footbridge or stepping stones across a stream,
// edging stones along a tread, and a cairn where trails meet. The terrain
// supplies spans and positions, so these are pure builders that a trail's
// route calls, not primitives Jev picks.

import type { Built, Part, Rand, Vec3 } from "@gaia/schema";
import { rand } from "@gaia/schema";
import { type Channels, LOSS_BAND, PartBuilder, type V3, normalize } from "./kit.ts";
import { UP, beam, box, log, quad, tri } from "./blocks.ts";

const nonEmpty = (parts: Part[]): Part[] => parts.filter((p) => p.indices.length > 0);

/** Half a plank's thickness in meters. The deck's top is this far above the planks' centers. */
const PLANK_HALF = 0.035;

/** A footbridge deck's half width, and its top at `u` meters from mid-span, measured above the bank it rests on. */
export interface FootbridgeDeck {
  readonly halfWidth: number;
  topAt(u: number): number;
}

/** The slightly arched deck of a footbridge `span` long and `width` wide. The planks lie on it, and so does the walkable surface. */
export function footbridgeDeck(span: number, width: number): FootbridgeDeck {
  const arch = 0.2 + span * 0.035;
  const lift = 0.12;
  return { halfWidth: Math.max(1.3, width) / 2, topAt: (u) => lift + arch * (1 - Math.pow((2 * u) / span, 2)) + PLANK_HALF };
}

/** The plank count for a footbridge `span` long, with planks 0.24 m wide and 2.5 cm gaps. */
const plankCount = (span: number): number => Math.max(4, Math.floor(span / (0.24 + 0.025)));

/** The vitality below which the plank at `x` is gone. Planks near mid-span, which bear the most, go soonest. It uses the plank's first draw from `pr`. */
const plankLoss = (pr: Rand, x: number, span: number): number => 0.7 * Math.pow(pr.next(), 1.7) * (0.75 + 0.25 * (1 - Math.abs((2 * x) / span)));

/** The widest deck gap in meters that a person steps across, about two planks. A wider gap ends the walkable deck. */
const STRIDE_GAP = 0.6;

/**
 * The vitality below which the footbridge `span` long built from `seed` can no longer be crossed. Below it, a run of
 * planks that are going or gone (within `LOSS_BAND`) spans more than `STRIDE_GAP` somewhere along the deck.
 */
export function footbridgeHolds(span: number, seed: number): number {
  const count = plankCount(span);
  const r = rand(seed);
  const losses = Array.from({ length: count }, (_, k) => plankLoss(r.fork(`plank${k}`), -span / 2 + (k + 0.5) * (span / count), span));
  const run = Math.floor(STRIDE_GAP / (span / count)) + 1;
  let holds = 0;
  for (let k = 0; k + run <= count; k++) holds = Math.max(holds, Math.min(...losses.slice(k, k + run)));
  return holds + LOSS_BAND;
}

/**
 * A plank footbridge along local +x, `span` long from bank to bank and
 * `width` wide, with a slightly arched deck. The deck is walkable. The origin
 * is mid-span at the higher bank's ground level.
 */
export function buildFootbridge(span: number, width: number, seed: number): Built {
  const r = rand(seed);
  const deck = new PartBuilder("timber", "walkable");
  const frame = new PartBuilder("timber", "solid");
  const stone = new PartBuilder("stone", "solid");
  const top = footbridgeDeck(span, width);
  const w = top.halfWidth * 2;
  const lift = 0.12;
  const yAt = (x: number): number => top.topAt(x) - PLANK_HALF;
  const still = (pivot: Vec3, wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot, ...extra });

  // Planks across the span. They go missing as vitality falls (`plankLoss`), about one in ten by 0.5 and most by 0.13.
  // The walkable deck keeps its line until a gap wider than a stride opens (`footbridgeHolds`).
  const count = plankCount(span);
  for (let k = 0; k < count; k++) {
    const x = -span / 2 + (k + 0.5) * (span / count);
    const pr = r.fork(`plank${k}`);
    const y = yAt(x);
    const slope = (top.topAt(x + 0.01) - top.topAt(x - 0.01)) / 0.02;
    const along = normalize([1, slope, 0]);
    const up = normalize([-slope, 1, 0]);
    const goes = plankLoss(pr, x, span);
    const pivot: V3 = [x, y - 0.6, 0];
    box(deck, [x, y, (pr.next() - 0.5) * 0.04], [along, up, [0, 0, 1]], [span / count / 2 - 0.012, PLANK_HALF, w / 2 + (pr.next() - 0.5) * 0.06], 0.44 + 0.12 * pr.next(), {
      loss: goes,
      droop: 0,
      wither: 0.7 + 0.25 * pr.next(),
      glow: 0,
      pivot,
      tint: (pr.next() - 0.5) * 0.03,
    });
  }
  // Two stringers under the deck's edges, following its arch.
  for (const side of [-1, 1]) {
    const segments = 6;
    for (let k = 0; k < segments; k++) {
      const x0 = -span / 2 + (k / segments) * span;
      const x1 = -span / 2 + ((k + 1) / segments) * span;
      beam(frame, [x0, yAt(x0) - 0.12, side * (w / 2 - 0.12)], [x1, yAt(x1) - 0.12, side * (w / 2 - 0.12)], 0.18, 0.14, UP, 0.36, still([0, 0, 0], 0.75));
    }
  }
  // Posts and a log rail on each side. As vitality falls, each rail sags off its far post, then hangs from the post
  // nearer the bank, swung down and out over the water, and finally falls into the stream. The posts never go.
  const posts = Math.max(2, Math.round(span / 2.2) + 1);
  for (const side of [-1, 1]) {
    const z = side * (w / 2 + 0.04);
    const tops: V3[] = [];
    for (let k = 0; k < posts; k++) {
      const x = -span / 2 + 0.15 + (k / (posts - 1)) * (span - 0.3);
      const base = yAt(x) - 0.2;
      const top = yAt(x) + 0.95;
      log(frame, [x, base, z], [x, top, z], 0.065, 0.4, still([x, base, z], 0.75), 6);
      tops.push([x, top - 0.06, z]);
    }
    for (let k = 0; k + 1 < tops.length; k++) {
      const a = tops[k] as V3;
      const b = tops[k + 1] as V3;
      const rr = r.fork(`rail${side}-${k}`);
      const [hold, free] = Math.abs(a[0]) >= Math.abs(b[0]) ? [a, b] : [b, a];
      // The rail turns about the post it hangs from, so its free end swings down and outward, clear of the deck.
      const axis = normalize([0, -side * 0.3, -1]);
      const swing = Math.sign(free[0] - hold[0]) * 1.25;
      const hangs = 0.12 + 0.45 * Math.pow(rr.next(), 1.3);
      const gone = rr.next() < 0.5 ? Math.max(0, (hangs - 0.16) * rr.next()) : 0;
      log(frame, a, b, 0.05, 0.46, { loss: gone, droop: 0.12, wither: 0.8, glow: 0, pivot: hold, fall: [axis[0] * swing, axis[1] * swing, axis[2] * swing, hangs] }, 6);
    }
  }
  // A footing stone at each end, so the deck never floats over a low bank.
  for (const end of [-1, 1]) {
    const x = end * (span / 2 - 0.2);
    const sr = r.fork(`footing${end}`);
    box(stone, [x, lift - 0.55, 0], [[1, 0, 0], UP, [0, 0, 1]], [0.32, 0.6, w / 2 + 0.1], 0.45 + 0.1 * sr.next(), still([x, -1, 0], 0.6));
  }
  return { parts: nonEmpty([deck.part(), frame.part(), stone.part()]), anchors: [] };
}

/**
 * Walkable flat stones in a line along local +x across `span` meters of
 * water, their tops a hand above the surface at y = 0 and their feet in the bed.
 */
export function buildSteppingStones(span: number, seed: number): Built {
  const r = rand(seed);
  const out = new PartBuilder("stone", "walkable");
  const count = Math.max(2, Math.round(span / 0.8));
  for (let k = 0; k < count; k++) {
    const sr = r.fork(`stone${k}`);
    const x = -span / 2 + (k + 0.5) * (span / count) + (sr.next() - 0.5) * 0.12;
    const z = (sr.next() - 0.5) * 0.35;
    const radius = 0.28 + sr.next() * 0.1;
    const top = 0.09 + sr.next() * 0.05;
    column(out, x, z, radius, top, -1.4, 0.48 + 0.14 * sr.next(), sr.next() * Math.PI, 0.8 + 0.3 * sr.next(), { loss: 0, droop: 0, wither: 0.55 + 0.3 * sr.next(), glow: 0, pivot: [x, -0.5, z], tint: (sr.next() - 0.5) * 0.04 });
  }
  return { parts: [out.part()], anchors: [] };
}

/** A low rounded stone column: a domed top over sides reaching down to `bottom`. */
function column(b: PartBuilder, x: number, z: number, radius: number, top: number, bottom: number, shade: number, turn: number, stretch: number, ch: Channels): void {
  const sides = 7;
  const rim: V3[] = [];
  const low: V3[] = [];
  for (let k = 0; k < sides; k++) {
    const t = turn + (k / sides) * Math.PI * 2;
    const j = 0.86 + 0.24 * Math.abs(Math.sin(t * 2.3 + turn * 5));
    const dx = Math.cos(t) * radius * j;
    const dz = Math.sin(t) * radius * j * stretch;
    rim.push([x + dx * 0.82, top, z + dz * 0.82]);
    low.push([x + dx, bottom, z + dz]);
  }
  const crown: V3 = [x, top + radius * 0.12, z];
  for (let k = 0; k < sides; k++) {
    const a = rim[k] as V3;
    const c = rim[(k + 1) % sides] as V3;
    tri(b, [crown, a, c], UP, shade + 0.06, ch);
    const out = normalize([(a[0] + c[0]) / 2 - x, 0.35, (a[2] + c[2]) / 2 - z]);
    quad(b, [low[k] as V3, low[(k + 1) % sides] as V3, c, a], out, [shade - 0.18, shade - 0.18, shade - 0.04, shade - 0.04], ch);
  }
}

/** Small stones set along a trail's edges, in world coordinates. */
export function buildEdgingStones(stones: readonly { x: number; y: number; z: number; yaw: number; size: number }[], seed: number): Built {
  const r = rand(seed);
  const out = new PartBuilder("stone", "none");
  for (const s of stones) {
    const sr = r.fork(`${s.x.toFixed(2)},${s.z.toFixed(2)}`);
    column(out, s.x, s.z, s.size, s.y + s.size * 0.32, s.y - 0.25, 0.48 + 0.16 * sr.next(), s.yaw, 0.6 + 0.3 * sr.next(), {
      loss: 0,
      droop: 0,
      wither: 0.5 + 0.4 * sr.next(),
      glow: 0,
      pivot: [s.x, s.y, s.z],
      tint: (sr.next() - 0.5) * 0.05,
    });
  }
  return { parts: [out.part()], anchors: [] };
}

/**
 * A small waymarker cairn where trails meet: a few flat stones, each smaller
 * than the one it rests on, about knee high, with its foot sunk below y = 0.
 * Nothing in it falls. Its stone weathers grey as vitality falls.
 */
export function buildCairn(seed: number): Built {
  const r = rand(seed);
  const out = new PartBuilder("stone", "none");
  const count = 4 + Math.floor(r.next() * 2);
  let y = 0.02;
  let radius = 0.34 + r.next() * 0.06;
  let x = 0;
  let z = 0;
  for (let k = 0; k < count; k++) {
    const sr = r.fork(`stone${k}`);
    const tall = radius * (0.42 + sr.next() * 0.18);
    // Each stone's foot sits a little inside the top of the stone below.
    column(out, x, z, radius, y + tall, k === 0 ? -0.18 : y - tall * 0.25, 0.46 + 0.16 * sr.next(), sr.next() * Math.PI, 0.75 + 0.25 * sr.next(), {
      loss: 0,
      droop: 0,
      wither: 0.5 + 0.35 * sr.next(),
      glow: 0,
      pivot: [x, y, z],
      tint: (sr.next() - 0.5) * 0.05,
    });
    y += tall + radius * 0.06;
    radius *= 0.72 + sr.next() * 0.08;
    x += (sr.next() - 0.5) * radius * 0.25;
    z += (sr.next() - 0.5) * radius * 0.25;
  }
  return { parts: [out.part()], anchors: [] };
}
