// Distance thins a component's detail. Each piece of a part (`Part.piece`)
// leaves whole at its own seeded distance, smaller pieces first. Until it
// leaves, a piece past its start grows with distance, so it keeps covering
// about a pixel and a drift keeps its color while its pieces thin. `detailAt`
// is the CPU reference: the far detail it returns is the full build with whole
// pieces left out and every kept vertex bit-identical, so a renderer can draw
// it instead once every piece it leaves out has already left on screen.

import type { Part } from "@gaia/schema";

export const DETAIL = {
  /**
   * A piece starts to thin this many times its size away. There it covers
   * about one pixel of a 58° view 800 pixels high.
   */
  reach: 720,
  /** The share of its leaving distance over which a piece shrinks to nothing. */
  band: 0.15,
  /** The leaving distance of a piece that never leaves. */
  never: 1e7,
} as const;

/**
 * A piece's seed from its number: an evenly spread sequence in (0, 1), so the
 * pieces of one size thin evenly. It draws from no random stream, so detail
 * never shifts anything a primitive builds.
 */
export function pieceSeed(index: number): number {
  return Math.max((0.5 + index * 0.6180339887498949) % 1, 1e-6);
}

export interface PieceReach {
  /** Where the piece starts to grow and thin, in meters from the eye. */
  readonly start: number;
  /** Where it has left: past this distance it draws nothing. */
  readonly leave: number;
}

/**
 * Where a piece starts to thin and where it has left, as 32-bit floats, the
 * numbers the shader reads. Of the pieces of one size, the share still there
 * at distance d past the start is (start / d)², and each has grown by
 * d / start, so together they cover what the full detail would.
 */
export function pieceReach(size: number, index: number): PieceReach {
  const start = DETAIL.reach * size;
  return { start: Math.fround(start), leave: Math.fround(Math.min(start / Math.sqrt(pieceSeed(index)), DETAIL.never)) };
}

export interface PieceFrames {
  /** The center of each vertex's piece, three per vertex. */
  readonly center: Float32Array;
  /** Each vertex's piece's start and leaving distance, two per vertex. */
  readonly reach: Float32Array;
}

/** Each vertex's piece center (the middle of the piece's bounds) and its reach. */
export function pieceFrames(part: Part): PieceFrames {
  const n = part.shade.length;
  const lo = new Map<number, [number, number, number]>();
  const hi = new Map<number, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const id = part.piece[i * 2] as number;
    const p = [part.positions[i * 3] as number, part.positions[i * 3 + 1] as number, part.positions[i * 3 + 2] as number] as const;
    const a = lo.get(id);
    const b = hi.get(id);
    if (a === undefined || b === undefined) {
      lo.set(id, [p[0], p[1], p[2]]);
      hi.set(id, [p[0], p[1], p[2]]);
      continue;
    }
    for (let k = 0; k < 3; k++) {
      a[k] = Math.min(a[k] as number, p[k] as number);
      b[k] = Math.max(b[k] as number, p[k] as number);
    }
  }
  const center = new Float32Array(n * 3);
  const reach = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const id = part.piece[i * 2] as number;
    const a = lo.get(id) as [number, number, number];
    const b = hi.get(id) as [number, number, number];
    for (let k = 0; k < 3; k++) center[i * 3 + k] = ((a[k] as number) + (b[k] as number)) / 2;
    const r = pieceReach(part.piece[i * 2 + 1] as number, id);
    reach[i * 2] = r.start;
    reach[i * 2 + 1] = r.leave;
  }
  return { center, reach };
}

/**
 * The part as drawn from `distance` meters away and farther: every piece that
 * has left by then is left out whole, and every kept vertex is bit-identical
 * to the full build, in the same order.
 */
export function detailAt(part: Part, distance: number): Part {
  const n = part.shade.length;
  const keep = new Uint8Array(n);
  const map = new Int32Array(n).fill(-1);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    if (pieceReach(part.piece[i * 2 + 1] as number, part.piece[i * 2] as number).leave <= distance) continue;
    keep[i] = 1;
    map[i] = kept++;
  }
  if (kept === n) return part;
  const pick = (a: Float32Array, width: number): Float32Array => {
    const out = new Float32Array(kept * width);
    for (let i = 0; i < n; i++) {
      if (keep[i] === 0) continue;
      for (let k = 0; k < width; k++) out[(map[i] as number) * width + k] = a[i * width + k] as number;
    }
    return out;
  };
  const indices: number[] = [];
  for (let t = 0; t < part.indices.length; t += 3) {
    const a = part.indices[t] as number;
    if (keep[a] === 0) continue;
    indices.push(map[a] as number, map[part.indices[t + 1] as number] as number, map[part.indices[t + 2] as number] as number);
  }
  const c = part.channels;
  return {
    swatch: part.swatch,
    collision: part.collision,
    positions: pick(part.positions, 3),
    normals: pick(part.normals, 3),
    indices: new Uint32Array(indices),
    shade: pick(part.shade, 1),
    tint: pick(part.tint, 1),
    cutout: pick(part.cutout, 3),
    piece: pick(part.piece, 2),
    channels: {
      loss: pick(c.loss, 1),
      droop: pick(c.droop, 1),
      wither: pick(c.wither, 1),
      glow: pick(c.glow, 1),
      pivot: pick(c.pivot, 3),
      close: pick(c.close, 1),
    },
  };
}
