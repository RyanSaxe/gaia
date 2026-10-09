// What holds each piece of a ruin up. `unsupportedAt` applies the vitality
// channels as the shader does and finds every piece left standing on nothing:
// a block above a fallen course, a lintel whose stones fell, ivy on a wall
// that is gone, or a fallen piece that came to rest in mid-air. It is the CPU
// reference the contract tests hold every structure and landmark to, so no
// primitive can float a piece at any vitality.

import { type Part, SPRAYS } from "@gaia/schema";
import { CHANNEL_MATH, applyVitality } from "./channels.ts";
import { FLUTTERS, type WindState } from "./sway.ts";

export const SUPPORT = {
  /** A piece whose lowest point is this close to the ground (y = 0) stands on it. */
  ground: 0.1,
  /** Surfaces this close touch whichever way they face: a stone set in mortar, a beam let into a post. */
  glue: 0.015,
  /** Across a gap up to this wide a piece still rests on what is below it, as a block rests on the course under it across its joint. */
  gap: 0.06,
  /** A fallen piece may lie this far sunk into the ground, as a stone lies half in the grass. */
  sink: 0.5,
  /** Leaf cards cling to what they grow on by stems too fine to model: ivy on a wall, a leaf on its twig. */
  cling: 0.15,
  /** A point this far behind the nearest face of a solid is inside it, as a falling block sinks into the wall under it. */
  within: 0.25,
} as const;

/** A piece left unsupported at some vitality. */
export interface Unsupported {
  /** Which part, and one vertex of the piece in it. */
  readonly part: number;
  readonly vertex: number;
  /** Where the piece is at that vitality: the middle of its bounds, its lowest point and its size. */
  readonly at: readonly [number, number, number];
  readonly low: number;
  readonly size: number;
  /** Standing on nothing; fallen but resting on nothing past its hinge; or fallen deep into the ground. */
  readonly why: "floating" | "unrested" | "sunk";
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** How much of a vertex stands at vitality `v`: 1 whole, 0 collapsed or not yet grown, as the shader scales it. */
function keepOf(part: Part, i: number, v: number): number {
  const loss = part.channels.loss[i] ?? 0;
  const grow = part.channels.grow?.[i] ?? 0;
  // A spray stays where it is while its leaves drop one by one, the last a little below its loss.
  if (SPRAYS.has(Math.floor(part.cutout[i * 3 + 2] ?? 0))) return loss > 0 ? smoothstep(loss - CHANNEL_MATH.dropSpread, loss + CHANNEL_MATH.dropSpread + CHANNEL_MATH.lossBand, v) : 1;
  return (loss > 0 ? smoothstep(loss, loss + CHANNEL_MATH.lossBand, v) : 1) * (grow > 0 ? 1 - smoothstep(grow, grow + CHANNEL_MATH.lossBand, v) : 1);
}

/** How far a vertex has fallen at vitality `v`: 0 upright, 1 fully fallen; -1 when it never falls. */
function fallenOf(part: Part, i: number, v: number): number {
  const fall = part.channels.fall;
  const from = fall?.[i * 4 + 3] ?? 0;
  if (fall === undefined || from <= 0 || Math.hypot(fall[i * 4] ?? 0, fall[i * 4 + 1] ?? 0, fall[i * 4 + 2] ?? 0) < 1e-6) return -1;
  return 1 - smoothstep(from - CHANNEL_MATH.fallBand, from, v);
}

class Unions {
  readonly #up: Int32Array;
  constructor(n: number) {
    this.#up = new Int32Array(n);
    for (let i = 0; i < n; i++) this.#up[i] = i;
  }
  find(a: number): number {
    let r = a;
    while (this.#up[r] !== r) r = this.#up[r] as number;
    while (this.#up[a] !== r) {
      const next = this.#up[a] as number;
      this.#up[a] = r;
      a = next;
    }
    return r;
  }
  join(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.#up[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** The closest point to `p` on triangle abc (Ericson, Real-Time Collision Detection 5.1.5), written to `out`. */
function closest(px: number, py: number, pz: number, t: Float64Array, o: number, out: Float64Array): void {
  const ax = t[o] as number, ay = t[o + 1] as number, az = t[o + 2] as number;
  const abx = (t[o + 3] as number) - ax, aby = (t[o + 4] as number) - ay, abz = (t[o + 5] as number) - az;
  const acx = (t[o + 6] as number) - ax, acy = (t[o + 7] as number) - ay, acz = (t[o + 8] as number) - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  let v: number;
  let w: number;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2;
  const vb = d5 * d2 - d1 * d6;
  const va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) {
    v = 0;
    w = 0;
  } else if (d3 >= 0 && d4 <= d3) {
    v = 1;
    w = 0;
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    v = d1 / (d1 - d3);
    w = 0;
  } else if (d6 >= 0 && d5 <= d6) {
    v = 0;
    w = 1;
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    v = 0;
    w = d2 / (d2 - d6);
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    v = 1 - w;
  } else {
    const den = 1 / (va + vb + vc);
    v = vb * den;
    w = vc * den;
  }
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}

const bits = new Float32Array(1);
const word = new Uint32Array(bits.buffer);

/** A piece's channels apart from its shape, what makes it move and go as one, hashed from their exact bits. */
function signature(part: Part, i: number): number {
  const c = part.channels;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const mix = (x: number): void => {
    bits[0] = x;
    const w = word[0] as number;
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ (w >>> 7) ^ (w << 13), 0x5bd1e995);
  };
  mix(c.pivot[i * 3] ?? 0);
  mix(c.pivot[i * 3 + 1] ?? 0);
  mix(c.pivot[i * 3 + 2] ?? 0);
  mix(c.loss[i] ?? 0);
  mix(c.grow?.[i] ?? 0);
  for (let k = 0; k < 4; k++) mix(c.fall?.[i * 4 + k] ?? 0);
  return (h1 >>> 0) * 2 ** 21 + ((h2 >>> 0) & 0x1fffff);
}

/** Swatches that are not solid things: smoke rises on its own. */
const WEIGHTLESS = new Set(["smoke"]);
const CELL = 0.35;
/** Long edges are probed every this many meters. */
const EDGE = 0.3;

/**
 * Every piece of `parts` left unsupported at vitality `v`, with the ground at
 * y = 0. A piece is the vertices that move and go together: those joined by
 * triangles or sharing one pivot and one response. Every piece still showing,
 * whole or partway through collapsing or growing in, must rest on the ground
 * or on another piece that is itself supported, where both are at that
 * vitality: across a gap no wider than `SUPPORT.gap` from above, touching
 * within `SUPPORT.glue` from any side, or let into it (a point just behind
 * its nearest face). Leaf cards cling within `SUPPORT.cling`, or hang from
 * their stalk: a pivot on the card within `SUPPORT.cling` of what carries
 * it. Smoke is not counted. With `wind`, every piece stands where that
 * moment's wind bends it (`swayAt`). A piece that has fully fallen over its hinge
 * must also rest away from it, on the ground or on something standing, and
 * not lie sunk into the ground. With `moving: false`, only pieces wholly
 * standing are counted, as when vitality has settled between thresholds.
 */
export function unsupportedAt(parts: readonly Part[], v: number, options: { readonly moving?: boolean; readonly wind?: WindState } = {}): Unsupported[] {
  const moving = options.moving ?? true;
  const offsets: number[] = [];
  let total = 0;
  for (const p of parts) {
    offsets.push(total);
    total += p.shade.length;
  }
  const unions = new Unions(total);
  parts.forEach((part, pi) => {
    const base = offsets[pi] as number;
    for (let t = 0; t < part.indices.length; t += 3) {
      unions.join(base + (part.indices[t] as number), base + (part.indices[t + 1] as number));
      unions.join(base + (part.indices[t] as number), base + (part.indices[t + 2] as number));
    }
    const first = new Map<number, number>();
    for (let i = 0; i < part.shade.length; i++) {
      const key = signature(part, i);
      const seen = first.get(key);
      if (seen === undefined) first.set(key, base + i);
      else unions.join(seen, base + i);
    }
  });

  // Every vertex where the channels put it, and each piece's state.
  const pos = new Float64Array(total * 3);
  const rest = new Float64Array(total * 3);
  const bodyOf = new Int32Array(total);
  interface Body {
    keepLo: number;
    keepHi: number;
    fallen: number;
    lo: [number, number, number];
    hi: [number, number, number];
    restLow: number;
    pivot: [number, number, number];
    reach: number;
    part: number;
    vertex: number;
    weightless: boolean;
    card: boolean;
    /** Where the piece's pivot is now, and how far it lies from the piece as built: a card's stalk is on the card. */
    stalk: [number, number, number];
    stalkGap: number;
  }
  const bodies: Body[] = [];
  const index = new Map<number, number>();
  parts.forEach((part, pi) => {
    const base = offsets[pi] as number;
    const wind = options.wind === undefined ? undefined : { state: options.wind, flutter: FLUTTERS.has(part.swatch) };
    const seen = applyVitality(part, v, undefined, wind).positions;
    // Each piece's pivot as vitality and the wind carry it: where a card's stalk meets what holds it.
    const stalks = applyVitality({ ...part, positions: part.channels.pivot }, v, undefined, wind).positions;
    for (let i = 0; i < part.shade.length; i++) {
      const g = base + i;
      for (let c = 0; c < 3; c++) {
        pos[g * 3 + c] = seen[i * 3 + c] as number;
        rest[g * 3 + c] = part.positions[i * 3 + c] as number;
      }
      const root = unions.find(g);
      let b = index.get(root);
      if (b === undefined) {
        b = bodies.length;
        index.set(root, b);
        bodies.push({ keepLo: 1, keepHi: 0, fallen: -1, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], restLow: Infinity, pivot: [part.channels.pivot[i * 3] as number, part.channels.pivot[i * 3 + 1] as number, part.channels.pivot[i * 3 + 2] as number], reach: 0, part: pi, vertex: i, weightless: WEIGHTLESS.has(part.swatch), card: true, stalk: [stalks[i * 3] as number, stalks[i * 3 + 1] as number, stalks[i * 3 + 2] as number], stalkGap: Infinity });
      }
      bodyOf[g] = b;
      const body = bodies[b] as Body;
      if ((part.cutout[i * 3 + 2] ?? 0) < 1) body.card = false;
      const keep = keepOf(part, i, v);
      body.keepLo = Math.min(body.keepLo, keep);
      body.keepHi = Math.max(body.keepHi, keep);
      body.fallen = Math.max(body.fallen, fallenOf(part, i, v));
      body.restLow = Math.min(body.restLow, rest[g * 3 + 1] as number);
      const gap = Math.hypot((rest[g * 3] as number) - (part.channels.pivot[i * 3] as number), (rest[g * 3 + 1] as number) - (part.channels.pivot[i * 3 + 1] as number), (rest[g * 3 + 2] as number) - (part.channels.pivot[i * 3 + 2] as number));
      body.stalkGap = Math.min(body.stalkGap, gap);
      for (let c = 0; c < 3; c++) {
        body.lo[c] = Math.min(body.lo[c] as number, pos[g * 3 + c] as number);
        body.hi[c] = Math.max(body.hi[c] as number, pos[g * 3 + c] as number);
      }
    }
  });
  /** Still showing, whole or partly gone: it must be held up, and holds up what rests on it where it is now. */
  const near = new Float64Array(3);
  const shown = (b: Body): boolean => (moving ? b.keepHi > 0.15 : b.keepLo > 0.999) && !b.weightless;
  // A card's stalk may meet it between its corners: measure from its pivot to its own surface.
  const restTri = new Float64Array(9);
  parts.forEach((part, pi) => {
    const base = offsets[pi] as number;
    for (let t = 0; t < part.indices.length; t += 3) {
      const ia = part.indices[t] as number;
      const body = bodies[bodyOf[base + ia] as number] as Body;
      if (!body.card || body.stalkGap <= SUPPORT.glue) continue;
      for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) restTri[k * 3 + c] = part.positions[(part.indices[t + k] as number) * 3 + c] as number;
      const pv = part.channels.pivot;
      closest(pv[ia * 3] as number, pv[ia * 3 + 1] as number, pv[ia * 3 + 2] as number, restTri, 0, near);
      body.stalkGap = Math.min(body.stalkGap, Math.hypot((pv[ia * 3] as number) - (near[0] as number), (pv[ia * 3 + 1] as number) - (near[1] as number), (pv[ia * 3 + 2] as number) - (near[2] as number)));
    }
  });
  for (let g = 0; g < total; g++) {
    const body = bodies[bodyOf[g] as number] as Body;
    body.reach = Math.max(body.reach, Math.hypot((pos[g * 3] as number) - body.pivot[0], (pos[g * 3 + 1] as number) - body.pivot[1], (pos[g * 3 + 2] as number) - body.pivot[2]));
  }

  // The triangles of every piece still showing, hashed into cells.
  // Each triangle's outward normal is its winding's, turned to agree with
  // the normals the part was built with, so a point behind it is inside.
  const tris: number[] = [];
  const triBody: number[] = [];
  const triOut: number[] = [];
  const at = (arr: ArrayLike<number>, g: number, c: number): number => arr[g * 3 + c] as number;
  const crossOf = (arr: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] => {
    const ux = at(arr, b, 0) - at(arr, a, 0), uy = at(arr, b, 1) - at(arr, a, 1), uz = at(arr, b, 2) - at(arr, a, 2);
    const wx = at(arr, c, 0) - at(arr, a, 0), wy = at(arr, c, 1) - at(arr, a, 1), wz = at(arr, c, 2) - at(arr, a, 2);
    return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  };
  parts.forEach((part, pi) => {
    const base = offsets[pi] as number;
    for (let t = 0; t < part.indices.length; t += 3) {
      const ia = part.indices[t] as number, ib = part.indices[t + 1] as number, ic = part.indices[t + 2] as number;
      const b = bodyOf[base + ia] as number;
      if (!shown(bodies[b] as Body)) continue;
      for (const g of [base + ia, base + ib, base + ic]) tris.push(pos[g * 3] as number, pos[g * 3 + 1] as number, pos[g * 3 + 2] as number);
      triBody.push(b);
      const was = crossOf(part.positions, ia, ib, ic);
      const n = part.normals;
      const agree = was[0] * (at(n, ia, 0) + at(n, ib, 0) + at(n, ic, 0)) + was[1] * (at(n, ia, 1) + at(n, ib, 1) + at(n, ic, 1)) + was[2] * (at(n, ia, 2) + at(n, ib, 2) + at(n, ic, 2));
      const now = crossOf(pos, base + ia, base + ib, base + ic);
      const l = (agree < 0 ? -1 : 1) / (Math.hypot(now[0], now[1], now[2]) || 1);
      triOut.push(now[0] * l, now[1] * l, now[2] * l);
    }
  });
  const triPos = Float64Array.from(tris);
  // Each triangle's bounds, grown by how far a probe may be judged from it, for a quick rejection.
  const triBox = new Float64Array(triBody.length * 6);
  for (let t = 0; t < triBody.length; t++) {
    for (let c = 0; c < 3; c++) {
      const a = triPos[t * 9 + c] as number, b = triPos[t * 9 + 3 + c] as number, d = triPos[t * 9 + 6 + c] as number;
      triBox[t * 6 + c] = Math.min(a, b, d) - SUPPORT.within;
      triBox[t * 6 + 3 + c] = Math.max(a, b, d) + SUPPORT.within;
    }
  }
  const cells = new Map<number, number[]>();
  const cellKey = (x: number, y: number, z: number): number => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
  for (let t = 0; t < triBody.length; t++) {
    const o = t * 9;
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
    for (let k = 0; k < 3; k++) {
      lx = Math.min(lx, triPos[o + k * 3] as number);
      ly = Math.min(ly, triPos[o + k * 3 + 1] as number);
      lz = Math.min(lz, triPos[o + k * 3 + 2] as number);
      hx = Math.max(hx, triPos[o + k * 3] as number);
      hy = Math.max(hy, triPos[o + k * 3 + 1] as number);
      hz = Math.max(hz, triPos[o + k * 3 + 2] as number);
    }
    const m = SUPPORT.within;
    for (let x = Math.floor((lx - m) / CELL); x <= Math.floor((hx + m) / CELL); x++)
      for (let y = Math.floor((ly - m) / CELL); y <= Math.floor((hy + m) / CELL); y++)
        for (let z = Math.floor((lz - m) / CELL); z <= Math.floor((hz + m) / CELL); z++) {
          const key = cellKey(x, y, z);
          const list = cells.get(key);
          if (list === undefined) cells.set(key, [t]);
          else list.push(t);
        }
  }

  // Contacts: who rests on whom, who is stuck to whom, and the farthest
  // point from its hinge where a piece rests on another.
  const restsOn = new Map<number, Set<number>>();
  const farRest = new Map<number, number>();
  const pair = (top: number, under: number): number => top * 4194304 + under;
  const link = (map: Map<number, Set<number>>, a: number, b: number): void => {
    const s = map.get(a);
    if (s === undefined) map.set(a, new Set([b]));
    else s.add(b);
  };
  const onRest = (top: number, under: number, x: number, y: number, z: number): void => {
    link(restsOn, top, under);
    const body = bodies[top] as Body;
    const d = Math.hypot(x - body.pivot[0], y - body.pivot[1], z - body.pivot[2]);
    const key = pair(top, under);
    const was = farRest.get(key);
    if (was === undefined || d > was) farRest.set(key, d);
  };
  // Each vertex, and points along each long edge (so a board nailed across
  // a frame touches it even where neither has a vertex), is judged against
  // the nearest face of each piece near it.
  const probes: number[] = [];
  const probeBody: number[] = [];
  for (let g = 0; g < total; g++) {
    if (!shown(bodies[bodyOf[g] as number] as Body)) continue;
    probes.push(pos[g * 3] as number, pos[g * 3 + 1] as number, pos[g * 3 + 2] as number);
    probeBody.push(bodyOf[g] as number);
  }
  for (let t = 0; t < triBody.length; t++) {
    const o = t * 9;
    for (let e = 0; e < 3; e++) {
      const a = o + e * 3;
      const c = o + ((e + 1) % 3) * 3;
      const len = Math.hypot((triPos[c] as number) - (triPos[a] as number), (triPos[c + 1] as number) - (triPos[a + 1] as number), (triPos[c + 2] as number) - (triPos[a + 2] as number));
      const n = Math.floor(len / EDGE);
      for (let k = 1; k <= n; k++) {
        const f = k / (n + 1);
        for (let i = 0; i < 3; i++) probes.push((triPos[a + i] as number) + ((triPos[c + i] as number) - (triPos[a + i] as number)) * f);
        probeBody.push(triBody[t] as number);
      }
    }
  }
  // The nearest face of each piece near a probe: parallel lists, reused.
  const nb: number[] = [];
  const nt: number[] = [];
  const nd: number[] = [];
  const nx: number[] = [];
  const ny: number[] = [];
  const nz: number[] = [];
  for (let q = 0; q < probeBody.length; q++) {
    const b = probeBody[q] as number;
    const body = bodies[b] as Body;
    const px = probes[q * 3] as number, py = probes[q * 3 + 1] as number, pz = probes[q * 3 + 2] as number;
    const list = cells.get(cellKey(Math.floor(px / CELL), Math.floor(py / CELL), Math.floor(pz / CELL)));
    if (list === undefined) continue;
    nb.length = 0;
    for (const t of list) {
      const other = triBody[t] as number;
      if (other === b) continue;
      const o = t * 6;
      if (px < (triBox[o] as number) || py < (triBox[o + 1] as number) || pz < (triBox[o + 2] as number) || px > (triBox[o + 3] as number) || py > (triBox[o + 4] as number) || pz > (triBox[o + 5] as number)) continue;
      closest(px, py, pz, triPos, t * 9, near);
      const d = Math.hypot(px - (near[0] as number), py - (near[1] as number), pz - (near[2] as number));
      if (d > SUPPORT.within) continue;
      const k = nb.indexOf(other);
      if (k >= 0 && (nd[k] as number) <= d) continue;
      const at = k >= 0 ? k : nb.length;
      nb[at] = other;
      nt[at] = t;
      nd[at] = d;
      nx[at] = near[0] as number;
      ny[at] = near[1] as number;
      nz[at] = near[2] as number;
    }
    for (let k = 0; k < nb.length; k++) {
      const other = nb[k] as number;
      const t = nt[k] as number;
      const d = nd[k] as number;
      const x = nx[k] as number, y = ny[k] as number, z = nz[k] as number;
      const dx = px - x, dy = py - y, dz = pz - z;
      // Behind the nearest face is inside the other piece: a beam let into a post.
      const inside = d > 1e-9 && dx * (triOut[t * 3] as number) + dy * (triOut[t * 3 + 1] as number) + dz * (triOut[t * 3 + 2] as number) < 0;
      // A card clings to what it grows on, and holds nothing up itself.
      const card = (bodies[other] as Body).card;
      if (body.card || card) {
        if (d > SUPPORT.cling) continue;
        if (body.card && !card) onRest(b, other, px, py, pz);
        else if (card && !body.card) onRest(other, b, x, y, z);
      } else if (d <= SUPPORT.glue || inside) {
        onRest(b, other, px, py, pz);
        onRest(other, b, x, y, z);
      } else if (d > SUPPORT.gap) continue;
      else if (dy >= 0.5 * d) onRest(b, other, px, py, pz);
      else if (-dy >= 0.5 * d) onRest(other, b, x, y, z);
    }
  }

  // A leaf card also hangs from its stalk, where it meets what it grows on:
  // its pivot, which must lie on the card itself, wherever vitality and the
  // wind have carried it.
  bodies.forEach((body, b) => {
    if (!shown(body) || !body.card || body.stalkGap > SUPPORT.cling) return;
    const [px, py, pz] = body.stalk;
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), cz = Math.floor(pz / CELL);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = cz - 1; z <= cz + 1; z++)
          for (const t of cells.get(cellKey(x, y, z)) ?? []) {
            const other = triBody[t] as number;
            if (other === b || (bodies[other] as Body).card) continue;
            closest(px, py, pz, triPos, t * 9, near);
            if (Math.hypot(px - (near[0] as number), py - (near[1] as number), pz - (near[2] as number)) <= SUPPORT.cling) onRest(b, other, px, py, pz);
          }
  });

  // Support spreads up from the ground through what rests on what.
  const held = new Uint8Array(bodies.length);
  const queue: number[] = [];
  bodies.forEach((body, b) => {
    if (shown(body) && body.lo[1] <= SUPPORT.ground) {
      held[b] = 1;
      queue.push(b);
    }
  });
  const carried = new Map<number, number[]>();
  for (const [top, unders] of restsOn) for (const u of unders) carried.set(u, [...(carried.get(u) ?? []), top]);
  while (queue.length > 0) {
    const b = queue.pop() as number;
    for (const top of carried.get(b) ?? []) {
      if (held[top] === 1) continue;
      held[top] = 1;
      queue.push(top);
    }
  }

  const out: Unsupported[] = [];
  bodies.forEach((body, b) => {
    if (!shown(body)) return;
    const at: [number, number, number] = [(body.lo[0] + body.hi[0]) / 2, (body.lo[1] + body.hi[1]) / 2, (body.lo[2] + body.hi[2]) / 2];
    const size = Math.hypot(body.hi[0] - body.lo[0], body.hi[1] - body.lo[1], body.hi[2] - body.lo[2]);
    const report = (why: Unsupported["why"]): void => void out.push({ part: body.part, vertex: body.vertex, at, low: body.lo[1], size, why });
    if (held[b] !== 1) return report("floating");
    // Fully fallen and toppled over its hinge (not hanging from it, as a
    // shutter or a lantern does): it lies on the ground, or rests on
    // something standing away from its hinge.
    if (body.fallen < 0.999 || at[1] < body.pivot[1]) return;
    if (body.lo[1] < Math.min(body.restLow, 0) - SUPPORT.sink) return report("sunk");
    if (body.lo[1] <= SUPPORT.ground) return;
    const rests = [...(restsOn.get(b) ?? [])].some((u) => held[u] === 1 && (farRest.get(pair(b, u)) ?? 0) >= 0.5 * body.reach);
    if (!rests) report("unrested");
  });
  return out;
}
