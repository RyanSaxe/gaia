// What a trail is built from where the ground alone will not do: a small
// footbridge or a line of stepping stones across a stream, stones set along
// a tread's edges, and a little cairn where ways meet. Spans and positions come from the terrain, so these
// are pure builders a trail's route calls, not primitives Jev picks.
// Each writes vitality channels: planks go missing and rails sag in decline,
// and stone weathers grey.

import type { Built, Part, Vec3 } from "@gaia/schema";
import { rand } from "@gaia/schema";
import { type Channels, PartBuilder, type V3, lossThreshold, normalize } from "./kit.ts";
import { UP, beam, box, log, quad, tri } from "./blocks.ts";

const nonEmpty = (parts: Part[]): Part[] => parts.filter((p) => p.indices.length > 0);

/** Half a plank's thickness, meters: the deck's top stands this far above the planks' middles. */
const PLANK_HALF = 0.035;

/** Where a footbridge's deck is: its half width, and its top at `u` meters along the span from the middle, above the bank it rests on. */
export interface FootbridgeDeck {
  readonly halfWidth: number;
  topAt(u: number): number;
}

/** The deck of a footbridge `span` long and `width` wide, arching a little: its planks are laid on it, and a walk stands on it. */
export function footbridgeDeck(span: number, width: number): FootbridgeDeck {
  const arch = 0.2 + span * 0.035;
  const lift = 0.12;
  return { halfWidth: Math.max(1.3, width) / 2, topAt: (u) => lift + arch * (1 - Math.pow((2 * u) / span, 2)) + PLANK_HALF };
}

/**
 * A plank footbridge along local +x, `span` long from bank to bank and
 * `width` wide, its deck arching a little. The deck is walkable. The origin
 * is the middle of the span at the higher bank's ground.
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

  // Planks across the span; a few go missing as vitality falls.
  const plank = 0.24;
  const count = Math.max(4, Math.floor(span / (plank + 0.025)));
  for (let k = 0; k < count; k++) {
    const x = -span / 2 + (k + 0.5) * (span / count);
    const pr = r.fork(`plank${k}`);
    const y = yAt(x);
    const slope = (top.topAt(x + 0.01) - top.topAt(x - 0.01)) / 0.02;
    const along = normalize([1, slope, 0]);
    const up = normalize([-slope, 1, 0]);
    const missing = pr.next() < 0.3;
    const pivot: V3 = [x, y - 0.6, 0];
    box(deck, [x, y, (pr.next() - 0.5) * 0.04], [along, up, [0, 0, 1]], [span / count / 2 - 0.012, PLANK_HALF, w / 2 + (pr.next() - 0.5) * 0.06], 0.44 + 0.12 * pr.next(), {
      loss: missing ? lossThreshold(pr.next(), 0.42, 0.06) : 0,
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
  // Posts and a log rail on each side; the rails sag around their posts in decline.
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
      log(frame, a, b, 0.05, 0.46, { loss: 0, droop: 0.12, wither: 0.8, glow: 0, pivot: a }, 6);
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
 * Flat stones in a line along local +x across `span` meters of water, their
 * tops a hand above the surface at y = 0 and their feet in the bed. Walkable.
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
 * A little waymarker cairn where ways meet: a few flat stones, each bedded on
 * the one below and smaller than it, about knee high, its foot sunk in the
 * ground at y = 0. Nothing in it falls; its stone weathers grey in decline.
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
    // Each stone rests on the one below: its foot a little inside that one's top.
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
