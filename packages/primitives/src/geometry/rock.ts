// Rocks: noise-lumped bodies cut by a few planes, so they read as softly
// faceted painterly stone, half sunk into the ground. Moss grows over their
// upward faces and recedes, drying to lichen grey, as vitality falls.

import type { Anchor, BuildContext, Built, Part, Rand, Resolved } from "@gaia/schema";
import type { boulderParams, flatStoneParams, mossParams, outcropParams, stoneClusterParams } from "../rock.ts";
import { PartBuilder, type V3, clamp, cross, fbm3, icosphere, normalize, sub } from "./kit.ts";

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
}

/** Below this the body is flattened: it is always underground, so it needs no detail. */
const HIDDEN_DEPTH = 0.2;

function emitStone(out: PartBuilder, s: Stone, r: Rand, anchors: Anchor[], subdiv: number): void {
  const sphere = icosphere(subdiv);
  const seed = Math.floor(r.next() * 1e6);
  const planeCount = Math.round(6 + s.facets * 10);
  const planes: { n: V3; d: number }[] = [];
  for (let k = 0; k < planeCount; k++) {
    // Cuts favor the sides and shoulders; the buried base needs none.
    const a = r.next() * Math.PI * 2;
    const y = r.range(-0.25, 0.85);
    const h = Math.sqrt(1 - y * y);
    planes.push({ n: [Math.cos(a) * h, y, Math.sin(a) * h], d: r.range(0.66, 0.86) });
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

  const positions: V3[] = sphere.points.map((n) => {
    let q: V3 = [n[0], n[1], n[2]];
    const lump = 1 + 0.16 * fbm3(n[0] * 1.3 + seed * 0.001, n[1] * 1.3, n[2] * 1.3, seed, 3) + 0.05 * fbm3(n[0] * 3.7, n[1] * 3.7, n[2] * 3.7, seed + 5, 2);
    q = [q[0] * lump, q[1] * lump, q[2] * lump];
    for (const p of planes) {
      const over = q[0] * p.n[0] + q[1] * p.n[1] + q[2] * p.n[2] - p.d;
      if (over > 0) q = [q[0] - p.n[0] * over * cut, q[1] - p.n[1] * over * cut, q[2] - p.n[2] * over * cut];
    }
    if (s.top > 0) {
      const over = q[0] * topNormal[0] + q[1] * topNormal[1] + q[2] * topNormal[2] - s.top;
      if (over > 0) q = [q[0] - topNormal[0] * over, q[1] - topNormal[1] * over, q[2] - topNormal[2] * over];
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
  const height = Math.max(0.05, s.size[1]);
  positions.forEach((p, i) => {
    const n = normals[i] as V3;
    const above = (p[1] - s.base[1]) / height;
    const mottle = fbm3(p[0] * 1.6, p[1] * 1.6, p[2] * 1.6, seed + 3, 3);
    // Lighter toward the top, a soft darker band where the stone meets the ground.
    const ground = clamp(above / 0.22, 0, 1);
    const shade = 0.5 + 0.2 * mottle + 0.16 * clamp(above, 0, 1) - 0.2 * (1 - ground * ground) + 0.06 * n[1];
    out.vertex(p, n, shade, {
      loss: 0,
      droop: 0,
      wither: clamp(0.5 + 0.35 * fbm3(p[0] * 2.3, p[1] * 2.3, p[2] * 2.3, seed + 4, 2), 0.2, 0.9),
      glow: 0,
      pivot: s.base,
      tint: tint + 0.02 * mottle,
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

export function buildBoulder(p: Resolved<typeof boulderParams>, ctx: BuildContext): Built {
  const out = new PartBuilder("stone", "solid");
  const r = ctx.rand.fork("boulder");
  const h = p.size * sizeOf(ctx);
  const shape = BOULDER_SHAPES[p.shape];
  const anchors: Anchor[] = [];
  emitStone(
    out,
    {
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
    },
    r.fork("body"),
    anchors,
    3,
  );
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
  velvet: { thick: 0.025, lumps: 0.2, shade: 0.55 },
  cushions: { thick: 0.06, lumps: 1, shade: 0.5 },
  lichen: { thick: 0.012, lumps: 0.1, shade: 0.62 },
} as const;

/**
 * Moss on every upward face of the stone below it: a skin lifted a few
 * centimeters off the surface where noise and the face's tilt agree. Each
 * small piece shrinks to its own center as vitality falls, the ragged edges
 * of a patch first and its heart last, and what remains dries to lichen grey.
 */
export function buildMoss(p: Resolved<typeof mossParams>, ctx: BuildContext, base: Built): Built {
  const out = new PartBuilder("moss");
  const r = ctx.rand.fork("moss");
  const seed = Math.floor(r.next() * 1e6);
  const g = GROWTH[p.growth];
  const stones: Part[] = base.parts.filter((part) => part.swatch === "stone");
  const threshold = 1.15 - p.cover * 1.1;
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
      const want = up * 0.9 + 0.7 * patch + 0.35 * high - 0.3;
      mask[i] = clamp((want - threshold + 0.15) / 0.3, 0, 1) * (y > 0.02 ? 1 : 0);
    }
    const idx = part.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] as number;
      const b = idx[t + 1] as number;
      const c = idx[t + 2] as number;
      const m = ((mask[a] as number) + (mask[b] as number) + (mask[c] as number)) / 3;
      if (m < 0.34 || Math.min(mask[a] as number, mask[b] as number, mask[c] as number) <= 0) continue;
      const corners = [a, b, c].map((i) => [pos[i * 3] as number, pos[i * 3 + 1] as number, pos[i * 3 + 2] as number] as V3);
      const ca = corners[0] as V3;
      const cb = corners[1] as V3;
      const cc = corners[2] as V3;
      const center: V3 = [(ca[0] + cb[0] + cc[0]) / 3, (ca[1] + cb[1] + cc[1]) / 3, (ca[2] + cb[2] + cc[2]) / 3];
      const heart = clamp((m - 0.34) / 0.5, 0, 1);
      const jitter = fbm3(center[0] * 4.1, center[1] * 4.1, center[2] * 4.1, seed + 11, 1);
      const loss = clamp(0.62 - 0.52 * heart + 0.08 * jitter, 0.04, 0.7);
      const tint = clamp(0.05 * fbm3(center[0] * 0.7, center[1] * 0.7, center[2] * 0.7, seed + 13, 2), -0.06, 0.06);
      [a, b, c].forEach((i, k) => {
        const q = corners[k] as V3;
        const n: V3 = [nrm[i * 3] as number, nrm[i * 3 + 1] as number, nrm[i * 3 + 2] as number];
        const lump = 1 + g.lumps * fbm3(q[0] * 7, q[1] * 7, q[2] * 7, seed + 17, 2);
        const lift = g.thick * (0.35 + 0.65 * (mask[i] as number)) * Math.max(0.3, lump);
        const at: V3 = [q[0] + n[0] * lift, q[1] + n[1] * lift, q[2] + n[2] * lift];
        out.vertex(at, n, g.shade + 0.18 * (mask[i] as number) + 0.12 * (lump - 1) + 0.08 * n[1], {
          loss,
          droop: 0,
          wither: 0.85,
          glow: 0,
          pivot: center,
          tint,
        });
      });
      const first = out.vertexCount - 3;
      out.triangle(first, first + 1, first + 2);
    }
  }
  return { parts: [out.part()], anchors: base.anchors };
}
