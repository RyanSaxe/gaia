// Rocks: noise-lumped bodies cut by a few planes, so they read as softly
// faceted painterly stone, half sunk into the ground. Moss grows over their
// upward faces and recedes, drying to lichen grey, as vitality falls.

import { type Anchor, type BuildContext, type Built, CUT, type Part, type Rand, type Resolved } from "@gaia/schema";
import type { boulderParams, flatStoneParams, mossParams, outcropParams, stoneClusterParams } from "../rock.ts";
import { PartBuilder, type V3, clamp, cross, cutOf, fbm3, icosphere, normalize, sub } from "./kit.ts";

/** One stone's body in the rock's local frame. */
interface Stone {
  /** Where the stone meets the ground. */
  readonly base: V3;
  /** Width, height above ground and depth, in meters. */
  readonly size: V3;
  readonly yaw: number;
  /** A lean of the stone's up axis, radians, toward `leanDir`. */
  readonly lean: number;
  readonly leanDir: number;
  /** 0 is worn smooth, 1 is cut into sharp planes. */
  readonly facets: number;
  /** Where a flat top cuts the body, as a share of its half height above center; 0 means none. */
  readonly top: number;
  /** Tilt of the flat top, radians. */
  readonly topTilt: number;
  /** Horizontal layering, 0 to 1. */
  readonly strata: number;
  /** Share of the body's height that lies below ground. */
  readonly embed: number;
  /**
   * Keeps one half of a body split by a vertical plane through its center,
   * at `angle`, on `side` 1 or -1. Two halves make one stone that, as
   * vitality falls, slumps apart along the split: a crack opens.
   */
  readonly split?: { readonly angle: number; readonly side: number; readonly droop: number };
}

/** Below this the body is flattened: it is always underground, so it needs no detail. */
const HIDDEN_DEPTH = 0.2;

function emitStone(out: PartBuilder, s: Stone, r: Rand, anchors: Anchor[], subdiv: number): void {
  const sphere = icosphere(subdiv);
  const seed = Math.floor(r.next() * 1e6);
  const planeCount = Math.round(6 + s.facets * 10);
  const planes: { n: V3; d: number; hue: number }[] = [];
  for (let k = 0; k < planeCount; k++) {
    // Cuts favor the sides and shoulders; the buried base needs none.
    const a = r.next() * Math.PI * 2;
    const y = r.range(-0.25, 0.85);
    const h = Math.sqrt(1 - y * y);
    planes.push({ n: [Math.cos(a) * h, y, Math.sin(a) * h], d: r.range(0.66, 0.86), hue: r.range(-0.035, 0.035) });
  }
  const cut = 0.35 + 0.65 * s.facets;
  const tiltAxis = r.next() * Math.PI * 2;
  const topNormal = normalize([Math.cos(tiltAxis) * Math.sin(s.topTilt), Math.cos(s.topTilt), Math.sin(tiltAxis) * Math.sin(s.topTilt)]);
  // Half extents: the body's center sits so that `embed` of its height is buried.
  const ry = s.size[1] / (2 * (1 - s.embed));
  const cy = ry * (1 - 2 * s.embed);
  const cosY = Math.cos(s.yaw);
  const sinY = Math.sin(s.yaw);
  const cosL = Math.cos(s.lean);
  const sinL = Math.sin(s.lean);
  const lx = Math.cos(s.leanDir);
  const lz = Math.sin(s.leanDir);
  const floor = -s.size[1] * HIDDEN_DEPTH;
  const tint = r.range(-0.03, 0.03);

  // How deeply cut planes shaved each vertex, and the hue of the plane that shaved it most:
  // fresh fractures read lighter than weathered rounds, and each face takes its own tone.
  const fracture = new Float32Array(sphere.points.length);
  const faceHue = new Float32Array(sphere.points.length);
  const inCrack = new Float32Array(sphere.points.length);
  const splitN: V3 | null = s.split === undefined ? null : [Math.cos(s.split.angle), 0, Math.sin(s.split.angle)];
  const positions: V3[] = sphere.points.map((n, vi) => {
    let q: V3 = [n[0], n[1], n[2]];
    const lump = 1 + 0.16 * fbm3(n[0] * 1.3 + seed * 0.001, n[1] * 1.3, n[2] * 1.3, seed, 3) + 0.05 * fbm3(n[0] * 3.7, n[1] * 3.7, n[2] * 3.7, seed + 5, 2);
    q = [q[0] * lump, q[1] * lump, q[2] * lump];
    let deepest = 0;
    for (const p of planes) {
      const over = q[0] * p.n[0] + q[1] * p.n[1] + q[2] * p.n[2] - p.d;
      if (over <= 0) continue;
      q = [q[0] - p.n[0] * over * cut, q[1] - p.n[1] * over * cut, q[2] - p.n[2] * over * cut];
      if (over > deepest) {
        deepest = over;
        faceHue[vi] = p.hue;
      }
    }
    fracture[vi] = clamp(deepest / 0.08, 0, 1) * cut;
    if (s.top > 0) {
      const over = q[0] * topNormal[0] + q[1] * topNormal[1] + q[2] * topNormal[2] - s.top;
      if (over > 0) q = [q[0] - topNormal[0] * over, q[1] - topNormal[1] * over, q[2] - topNormal[2] * over];
    }
    if (splitN !== null && s.split !== undefined) {
      const along = q[0] * splitN[0] + q[2] * splitN[2];
      if (along * s.split.side < 0) {
        q = [q[0] - splitN[0] * along, q[1], q[2] - splitN[2] * along];
        inCrack[vi] = 1;
      }
    }
    if (s.strata > 0) {
      // Ledges: each layer's lower edge steps in a little.
      const band = (q[1] * 3.2 + 0.37 * fbm3(q[0] * 1.5, 0, q[2] * 1.5, seed + 9, 1)) % 1;
      const step = 1 - s.strata * 0.07 * (band < 0 ? band + 1 : band);
      q = [q[0] * step, q[1], q[2] * step];
    }
    // Scale, lean, turn and seat on the ground.
    let x = q[0] * s.size[0] * 0.5;
    let y = q[1] * ry + cy;
    let z = q[2] * s.size[2] * 0.5;
    [x, z] = [x * cosY - z * sinY, x * sinY + z * cosY];
    const along = x * lx + z * lz;
    const leaned = along * cosL - y * sinL;
    y = along * sinL + y * cosL;
    x += (leaned - along) * lx;
    z += (leaned - along) * lz;
    return [s.base[0] + x, s.base[1] + Math.max(y, floor), s.base[2] + z];
  });

  const normals = vertexNormals(positions, sphere.triangles);
  const first = out.vertexCount;
  // A half slumps around a point at the ground inside the other half, so its top leans away from the split.
  let pivot: V3 = [s.base[0], s.base[1], s.base[2]];
  if (splitN !== null && s.split !== undefined) {
    const px = splitN[0] * s.size[0] * 0.5;
    const pz = splitN[2] * s.size[2] * 0.5;
    const back = -0.45 * s.split.side;
    pivot = [s.base[0] + (px * cosY - pz * sinY) * back, s.base[1], s.base[2] + (px * sinY + pz * cosY) * back];
  }
  const height = Math.max(0.05, s.size[1]);
  positions.forEach((p, i) => {
    const n = normals[i] as V3;
    const above = (p[1] - s.base[1]) / height;
    const mottle = fbm3(p[0] * 1.6, p[1] * 1.6, p[2] * 1.6, seed + 3, 3);
    // Lighter toward the top, a soft darker band where the stone meets the ground.
    const ground = clamp(above / 0.22, 0, 1);
    // Rain streaks run down the sides: noise stretched tall.
    const streak = fbm3(p[0] * 4.5, p[1] * 0.6, p[2] * 4.5, seed + 6, 2);
    const shade =
      (0.46 + 0.16 * mottle + 0.12 * (fracture[i] as number) + 0.08 * streak + 0.16 * clamp(above, 0, 1) - 0.2 * (1 - ground * ground) + 0.06 * n[1]) *
      (1 - 0.55 * (inCrack[i] as number));
    out.vertex(p, n, shade, {
      loss: 0,
      droop: s.split?.droop ?? 0,
      wither: clamp(0.5 + 0.35 * fbm3(p[0] * 2.3, p[1] * 2.3, p[2] * 2.3, seed + 4, 2), 0.2, 0.9),
      glow: 0,
      pivot,
      tint: tint + 0.02 * mottle + (faceHue[i] as number) * (fracture[i] as number),
    });
    if (n[1] > 0.75 && above > 0.55 && i % 7 === 0) anchors.push({ position: p, normal: n, size: clamp(height, 0, 1) });
  });
  for (const [a, b, c] of sphere.triangles) out.triangle(first + a, first + b, first + c);
}

/** Smooth normals from area-weighted face normals, so cut planes stay flat-lit inside and soft at their edges. */
function vertexNormals(points: readonly V3[], triangles: readonly (readonly [number, number, number])[]): V3[] {
  const acc: V3[] = points.map(() => [0, 0, 0]);
  for (const [a, b, c] of triangles) {
    const pa = points[a] as V3;
    const f = cross(sub(points[b] as V3, pa), sub(points[c] as V3, pa));
    for (const i of [a, b, c]) {
      const v = acc[i] as V3;
      v[0] += f[0];
      v[1] += f[1];
      v[2] += f[2];
    }
  }
  return acc.map((v) => normalize(v));
}

const sizeOf = (ctx: BuildContext): number => 0.75 + 0.25 * (ctx.facts.scale ?? 1);

const built = (out: PartBuilder, anchors: Anchor[]): Built => ({ parts: [out.part()], anchors });

// ---------- boulder ----------

const BOULDER_SHAPES = {
  round: { w: 1.25, d: 1.15, lean: 0.05 },
  egg: { w: 0.8, d: 0.75, lean: 0.12 },
  wide: { w: 2, d: 1.6, lean: 0.03 },
  lopsided: { w: 1.4, d: 1.05, lean: 0.3 },
} as const;

/** How far a split boulder's halves slump apart at vitality 0. */
const CRACK_DROOP = 0.08;

export function buildBoulder(p: Resolved<typeof boulderParams>, ctx: BuildContext): Built {
  const out = new PartBuilder("stone", "solid");
  const r = ctx.rand.fork("boulder");
  const h = p.size * sizeOf(ctx);
  const shape = BOULDER_SHAPES[p.shape];
  const anchors: Anchor[] = [];
  const stone: Stone = {
    base: [0, 0, 0],
    size: [h * shape.w * r.range(0.9, 1.1), h, h * shape.d * r.range(0.9, 1.1)],
    yaw: r.next() * Math.PI * 2,
    lean: shape.lean * r.range(0.5, 1),
    leanDir: r.next() * Math.PI * 2,
    facets: p.facets,
    top: 0,
    topTilt: 0,
    strata: 0,
    embed: 0.3,
  };
  // One stone in two halves that meet exactly: whole while healthy, cracking open in decline.
  const angle = r.next() * Math.PI;
  for (const side of [1, -1]) emitStone(out, { ...stone, split: { angle, side, droop: CRACK_DROOP } }, r.fork("body"), anchors, 3);
  return built(out, anchors);
}

// ---------- flat-topped stone ----------

export function buildFlatStone(p: Resolved<typeof flatStoneParams>, ctx: BuildContext): Built {
  const out = new PartBuilder("stone", "walkable");
  const r = ctx.rand.fork("flat-stone");
  const w = p.size * sizeOf(ctx);
  const anchors: Anchor[] = [];
  const tops = p.top === "stepped" ? 2 : 1;
  for (let k = 0; k < tops; k++) {
    const sr = r.fork(`slab${k}`);
    const shift = tops === 1 ? 0 : (k - 0.5) * w * 0.42;
    const yaw = sr.next() * Math.PI * 2;
    emitStone(
      out,
      {
        base: [shift, 0, sr.range(-0.08, 0.08) * w],
        size: [w * (tops === 1 ? 1 : 0.7), w * (0.3 + 0.14 * k) * sr.range(0.9, 1.1), w * sr.range(0.65, 0.85)],
        yaw,
        lean: 0.03,
        leanDir: sr.next() * Math.PI * 2,
        facets: p.facets,
        top: 0.42,
        topTilt: p.top === "tilted" ? 0.24 : 0.05,
        strata: 0.4,
        embed: 0.3,
      },
      sr,
      anchors,
      3,
    );
  }
  return built(out, anchors);
}

// ---------- stone cluster ----------

export function buildStoneCluster(p: Resolved<typeof stoneClusterParams>, ctx: BuildContext): Built {
  const out = new PartBuilder("stone", "solid");
  const r = ctx.rand.fork("cluster");
  const h = p.size * sizeOf(ctx);
  const count = Math.max(2, Math.round(p.count));
  const anchors: Anchor[] = [];
  const placed: { x: number; z: number; rad: number }[] = [];
  for (let k = 0; k < count; k++) {
    const sr = r.fork(`stone${k}`);
    // The first stone is the largest; the rest shrink and gather around it.
    const scale = k === 0 ? 1 : sr.range(0.3, 0.7) * Math.pow(0.9, k);
    const size: V3 = [h * scale * sr.range(1, 1.6), h * scale, h * scale * sr.range(0.9, 1.4)];
    const rad = Math.max(size[0], size[2]) * 0.45;
    let x = 0;
    let z = 0;
    if (k > 0) {
      for (let tries = 0; tries < 12; tries++) {
        const a = sr.next() * Math.PI * 2;
        const host = placed[Math.floor(sr.next() * placed.length)] ?? placed[0];
        const d = (host?.rad ?? 0) + rad * sr.range(0.6, 1.1);
        x = (host?.x ?? 0) + Math.cos(a) * d;
        z = (host?.z ?? 0) + Math.sin(a) * d;
        if (placed.every((q) => Math.hypot(q.x - x, q.z - z) > (q.rad + rad) * 0.7)) break;
      }
    }
    placed.push({ x, z, rad });
    emitStone(
      out,
      {
        base: [x, 0, z],
        size,
        yaw: sr.next() * Math.PI * 2,
        lean: sr.range(0, 0.25),
        leanDir: Math.atan2(z, x) + sr.range(-0.5, 0.5),
        facets: p.facets,
        top: 0,
        topTilt: 0,
        strata: 0,
        embed: sr.range(0.25, 0.42),
      },
      sr,
      anchors,
      k === 0 ? 3 : 2,
    );
  }
  return built(out, anchors);
}

// ---------- outcrop ----------

const LAYERING = {
  massive: { strata: 0.15, facets: 0.55, top: 0.6, blocks: 1 },
  layered: { strata: 1, facets: 0.7, top: 0.38, blocks: 2 },
  blocky: { strata: 0.3, facets: 1, top: 0.3, blocks: 3 },
} as const;

export function buildOutcrop(p: Resolved<typeof outcropParams>, ctx: BuildContext): Built {
  const out = new PartBuilder("stone", "walkable");
  const r = ctx.rand.fork("outcrop");
  const k = sizeOf(ctx);
  const length = p.length * k;
  const height = p.height * k;
  const style = LAYERING[p.layering];
  // A ledge breaks the turf along a gentle curve, highest near its middle.
  const count = Math.max(3, Math.round(length / (1.6 + style.blocks * 0.2)));
  const bend = r.range(-0.25, 0.25);
  const anchors: Anchor[] = [];
  for (let i = 0; i < count; i++) {
    const sr = r.fork(`block${i}`);
    const t = count === 1 ? 0.5 : i / (count - 1);
    const along = (t - 0.5) * length;
    const rise = Math.sin(Math.PI * (0.15 + 0.7 * t));
    const blockH = height * (0.45 + 0.55 * rise) * sr.range(0.8, 1.15);
    const blockW = (length / count) * sr.range(1.25, 1.6);
    emitStone(
      out,
      {
        base: [along, 0, bend * along * along * 0.2 / Math.max(1, length) + sr.range(-0.2, 0.2)],
        size: [blockW, blockH, blockW * sr.range(0.55, 0.8) + height * 0.5],
        yaw: Math.atan(bend * along * 0.4 / Math.max(1, length)) + sr.range(-0.2, 0.2),
        lean: sr.range(0.04, 0.16),
        leanDir: Math.PI / 2 + sr.range(-0.4, 0.4),
        facets: style.facets,
        top: style.top,
        topTilt: sr.range(0.04, 0.2),
        strata: style.strata,
        embed: 0.35,
      },
      sr,
      anchors,
      i % 2 === 0 ? 3 : 2,
    );
  }
  return built(out, anchors);
}

// ---------- moss ----------

const GROWTH = {
  velvet: { thick: 0.025, lumps: 0.2, shade: 0.36 },
  cushions: { thick: 0.06, lumps: 1, shade: 0.32 },
  lichen: { thick: 0.012, lumps: 0.1, shade: 0.5 },
} as const;

/**
 * Moss on every upward face of the stone below it: a skin lifted a few
 * centimeters off the surface where noise and the face's tilt agree. The skin
 * is a patch (`CUT.patch`): each vertex carries how deep in the patch it
 * sits, and the shader ends the moss along a soft, winding contour of that
 * depth, never along the stone's triangles. The skin thins to nothing at that
 * edge, so it meets the stone flush. As vitality falls the edge creeps back
 * toward each patch's heart and what remains dries to lichen grey.
 */
export function buildMoss(p: Resolved<typeof mossParams>, ctx: BuildContext, base: Built): Built {
  const out = new PartBuilder("moss");
  const r = ctx.rand.fork("moss");
  const seed = Math.floor(r.next() * 1e6);
  const cut = cutOf(CUT.patch, r.next());
  const g = GROWTH[p.growth];
  const stones: Part[] = base.parts.filter((part) => part.swatch === "stone");
  const threshold = 1.2 - p.cover * 1.15;
  for (const part of stones) {
    const pos = part.positions;
    const nrm = part.normals;
    const count = pos.length / 3;
    let top = -Infinity;
    for (let i = 0; i < count; i++) top = Math.max(top, pos[i * 3 + 1] as number);
    const mask = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3] as number;
      const y = pos[i * 3 + 1] as number;
      const z = pos[i * 3 + 2] as number;
      const up = nrm[i * 3 + 1] as number;
      const patch = fbm3(x * 1.8, y * 1.8, z * 1.8, seed, 3);
      const high = clamp(y / Math.max(0.1, top), 0, 1);
      const want = up * 0.6 + 0.9 * patch + 0.25 * high - 0.3;
      mask[i] = clamp((want - threshold + 0.15) / 0.3, 0, 1) * (y > 0.02 ? 1 : 0);
    }
    const idx = part.indices;
    // The same vertex of the stone is the same vertex of the skin, so the skin stays smooth.
    const skin = new Map<number, number>();
    const skinVertex = (i: number): number => {
      const hit = skin.get(i);
      if (hit !== undefined) return hit;
      const q: V3 = [pos[i * 3] as number, pos[i * 3 + 1] as number, pos[i * 3 + 2] as number];
      const n: V3 = [nrm[i * 3] as number, nrm[i * 3 + 1] as number, nrm[i * 3 + 2] as number];
      const m = mask[i] as number;
      const lump = 1 + g.lumps * fbm3(q[0] * 7, q[1] * 7, q[2] * 7, seed + 17, 2);
      const lift = 0.004 + g.thick * smoothstep(0.15, 0.75, m) * Math.max(0.3, lump);
      const at: V3 = [q[0] + n[0] * lift, q[1] + n[1] * lift, q[2] + n[2] * lift];
      const jitter = clamp(0.5 + 0.9 * fbm3(q[0] * 6.3, q[1] * 6.3, q[2] * 6.3, seed + 23, 2), 0, 1);
      // On a stone that slumps in decline, moss rides along with it.
      const sag = part.channels.droop[i] as number;
      const pivot: V3 = [part.channels.pivot[i * 3] as number, part.channels.pivot[i * 3 + 1] as number, part.channels.pivot[i * 3 + 2] as number];
      const v = out.vertex(
        at,
        n,
        g.shade + 0.18 * m + 0.12 * (lump - 1) + 0.08 * n[1],
        {
          loss: 0,
          droop: sag,
          wither: 0.85,
          glow: 0,
          pivot,
          tint: clamp(0.05 * fbm3(q[0] * 0.7, q[1] * 0.7, q[2] * 0.7, seed + 13, 2), -0.06, 0.06),
        },
        [m, jitter, cut],
      );
      skin.set(i, v);
      return v;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] as number;
      const b = idx[t + 1] as number;
      const c = idx[t + 2] as number;
      // Only faces the patch's edge can reach: the shader cuts the rest of them away.
      if (Math.max(mask[a] as number, mask[b] as number, mask[c] as number) < 0.12) continue;
      out.triangle(skinVertex(a), skinVertex(b), skinVertex(c));
    }
  }
  return { parts: [out.part()], anchors: base.anchors };
}

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
