// Shrubs: many stems from one root crown, and leaf clumps that hug the frame
// down to the ground, so a bush reads as one soft mound rather than a small
// tree. Berries come from blossoms@1 on the mound's anchors.

import type { Anchor, BuildContext, Built, Limb, Resolved, Skeleton, Vec3 } from "@gaia/schema";
import type { leafMoundParams, thicketParams } from "../flora.ts";
import { PartBuilder, type V3, addScaled, clamp, fbm3, icosphere, lerp, lossThreshold, normalize } from "./kit.ts";

const HABITS = {
  mound: { width: 1.25, rise: 0.55, lift: 0.12 },
  spreading: { width: 2, rise: 0.35, lift: 0.06 },
  vase: { width: 0.95, rise: 0.85, lift: 0.3 },
} as const;

/** Stems from the root crown out to tips spread over a dome, plus low tips so leaves reach the ground. */
export function growThicket(p: Resolved<typeof thicketParams>, ctx: BuildContext): Skeleton {
  const habit = HABITS[p.habit];
  const s = ctx.facts.scale ?? 1;
  const height = Math.min(2, p.stature * (0.8 + 0.2 * s));
  const width = height * habit.width;
  const r = ctx.rand.fork("thicket");
  const stems = Math.max(2, Math.round(p.stems));
  const limbs: Limb[] = [];
  const tips: Anchor[] = [];
  const stemRadius = 0.012 + 0.018 * height;
  const dome = (az: number, up: number): V3 => [Math.cos(az) * Math.cos(up) * width * 0.5, Math.sin(up) * height * 0.92 + height * 0.08, Math.sin(az) * Math.cos(up) * width * 0.5];

  for (let i = 0; i < stems; i++) {
    const sr = r.fork(`stem${i}`);
    const az = (i / stems) * Math.PI * 2 + sr.range(-0.4, 0.4);
    const root: V3 = [Math.cos(az) * width * 0.06 * sr.next(), 0, Math.sin(az) * width * 0.06 * sr.next()];
    // Each stem rises and leans out toward its share of the dome.
    const up = sr.range(0.55, 1.25) * (0.6 + habit.rise * 0.6);
    const reach = dome(az, Math.min(1.45, up));
    const mid: V3 = [reach[0] * 0.55, reach[1] * (0.55 + habit.lift), reach[2] * 0.55];
    const stem = limbs.length;
    limbs.push({ start: root, end: mid, startRadius: stemRadius, endRadius: stemRadius * 0.7, depth: 0, parent: -1 });
    const twigs = 2 + (sr.next() < 0.5 ? 1 : 0);
    for (let k = 0; k < twigs; k++) {
      const tr = sr.fork(`twig${k}`);
      const taz = az + tr.range(-0.7, 0.7);
      const tup = clamp(up + tr.range(-0.45, 0.35), 0.15, 1.5);
      const end = dome(taz, tup);
      const jitter: V3 = [end[0] * tr.range(0.82, 1), end[1] * tr.range(0.85, 1), end[2] * tr.range(0.82, 1)];
      limbs.push({ start: mid, end: jitter, startRadius: stemRadius * 0.6, endRadius: stemRadius * 0.3, depth: 1, parent: stem });
      tips.push({ position: jitter, normal: normalize([jitter[0], jitter[1] - height * 0.35, jitter[2]]), size: 1 });
    }
    // A low shoot, so the mound's skirt reaches the soil.
    const low = dome(az + sr.range(-0.3, 0.3), sr.range(0.08, 0.3));
    const lowEnd: V3 = [low[0] * 0.9, low[1], low[2] * 0.9];
    limbs.push({ start: root, end: lowEnd, startRadius: stemRadius * 0.55, endRadius: stemRadius * 0.25, depth: 1, parent: stem });
    tips.push({ position: lowEnd, normal: normalize([lowEnd[0], 0.25, lowEnd[2]]), size: 0.7 });
  }
  // A crown tip on top keeps the mound from denting in its middle.
  tips.push({ position: [0, height, 0], normal: [0, 1, 0], size: 0.9 });
  limbs.push({ start: [0, 0, 0], end: [0, height * 0.9, 0], startRadius: stemRadius * 0.8, endRadius: stemRadius * 0.3, depth: 1, parent: 0 });
  return { limbs, tips };
}

const LEAVES = {
  rounded: { size: 1, lump: 0.24, count: 1, shade: 0 },
  glossy: { size: 0.9, lump: 0.14, count: 1, shade: 0.08 },
  feathery: { size: 0.62, lump: 0.36, count: 3, shade: -0.04 },
} as const;

/** A bush is placed by the hundred, so its mound stays small: the frame's tips first, then fill. */
const MOUND_TRIANGLE_BUDGET = 7_000;

/** Clumps at every tip and along the stems, shaded as one rounded volume that sits on the ground. */
export function buildLeafMound(p: Resolved<typeof leafMoundParams>, ctx: BuildContext, skel: Skeleton): Built {
  const out = new PartBuilder("leaf");
  const r = ctx.rand.fork("mound");
  const look = LEAVES[p.leaves];
  const tips = skel.tips;
  // The mound's volume: center and half extents from the tips and the ground.
  let top = 0.3;
  let reach = 0.3;
  for (const t of tips) {
    top = Math.max(top, t.position[1]);
    reach = Math.max(reach, Math.hypot(t.position[0], t.position[2]));
  }
  const center: V3 = [0, top * 0.45, 0];
  const radius: V3 = [reach, top * 0.6, reach];
  const outward = (q: V3): { dir: V3; depth: number } => {
    const d: V3 = [(q[0] - center[0]) / radius[0], (q[1] - center[1]) / radius[1], (q[2] - center[2]) / radius[2]];
    return { dir: normalize(d), depth: Math.hypot(d[0], d[1], d[2]) };
  };
  const base = clamp(Math.min(reach, top) * 0.42, 0.14, 1) * look.size * (0.75 + 0.35 * p.fullness);

  interface Clump {
    readonly at: V3;
    readonly pivot: Vec3;
    readonly radius: number;
  }
  const clumps: Clump[] = tips.map((t, i) => {
    const cr = r.fork(`tip${i}`);
    const rad = base * (0.7 + 0.4 * t.size) * cr.range(0.85, 1.15);
    const at = addScaled(t.position, t.normal, rad * 0.15);
    at[1] = Math.max(at[1], rad * 0.55);
    return { at, pivot: t.position, radius: rad };
  });
  // Fill along the stems, so the mound is solid from inside.
  const fill = Math.round(tips.length * Math.max(0, p.fullness - 0.25) * 1.4);
  for (let i = 0; i < fill && skel.limbs.length > 0; i++) {
    const fr = r.fork(`fill${i}`);
    const limb = skel.limbs[Math.floor(fr.next() * skel.limbs.length)] as Limb;
    const at = lerp(limb.start, limb.end, fr.range(0.45, 1));
    const rad = base * fr.range(0.85, 1.1);
    at[1] = Math.max(at[1], rad * 0.5);
    clumps.push({ at, pivot: limb.end, radius: rad });
  }
  const perClump = look.count * 320;
  // Feathery sprays are three small blobs each, so they drop to the coarser sphere first.
  const subdiv = look.count > 1 && clumps.length * perClump > MOUND_TRIANGLE_BUDGET ? 1 : 2;
  clumps.length = Math.min(clumps.length, Math.floor(MOUND_TRIANGLE_BUDGET / (look.count * (subdiv === 2 ? 320 : 80))));

  const anchors: Anchor[] = [];
  const sphere = icosphere(subdiv);
  clumps.forEach((clump, i) => {
    const cr = r.fork(`clump${i}`);
    const loss = lossThreshold(cr.next(), 0.6);
    const droop = 0.2 + 0.15 * cr.next();
    const wither = 0.75 + 0.25 * cr.next();
    const tint = cr.range(-0.07, 0.07);
    const seed = Math.floor(cr.next() * 1e6);
    for (let b = 0; b < look.count; b++) {
      const c: V3 =
        look.count === 1
          ? clump.at
          : [clump.at[0] + cr.range(-0.5, 0.5) * clump.radius, clump.at[1] + cr.range(-0.2, 0.4) * clump.radius, clump.at[2] + cr.range(-0.5, 0.5) * clump.radius];
      const rad = look.count === 1 ? clump.radius : clump.radius * cr.range(0.55, 0.75);
      const first = out.vertexCount;
      for (const n of sphere.points) {
        const lump = 1 + look.lump * fbm3(n[0] * 1.7 + seed * 0.013, n[1] * 1.7, n[2] * 1.7, seed + b, 3);
        // Clumps flatten a little underneath, and a low clump reaches all the way down to the soil.
        const sy = n[1] < 0 ? 0.7 : 0.9;
        const down = c[1] < Math.max(rad * 1.5, 0.45) ? Math.max(rad * sy * lump, c[1] - 0.02) : rad * sy * lump;
        const q: V3 = [c[0] + n[0] * rad * lump, Math.max(0.02, c[1] + n[1] * (n[1] < 0 ? down : rad * sy * lump)), c[2] + n[2] * rad * lump];
        const place = outward(q);
        const normal = normalize(lerp(n, place.dir, 0.65));
        const rim = clamp((place.depth - 0.35) / 0.7, 0, 1);
        const shade = 0.28 + 0.42 * rim + 0.14 * n[1] + 0.5 * tint + look.shade + 0.1 * clamp(q[1] / top, 0, 1);
        out.vertex(q, normal, shade, {
          loss: Math.max(0.01, loss + 0.06 * fbm3(n[0] * 3 + 5, n[1] * 3, n[2] * 3, seed + 7, 2)),
          droop,
          wither,
          glow: 0,
          pivot: clump.pivot,
          tint: tint * 0.4,
        });
      }
      for (const [a, bb, cc] of sphere.triangles) out.triangle(first + a, first + bb, first + cc);
    }
    for (let k = 0; k < 3; k++) {
      const d = normalize([cr.range(-1, 1), cr.range(-0.1, 1), cr.range(-1, 1)]);
      const facing = normalize(lerp(d, outward(clump.at).dir, 0.6));
      anchors.push({ position: addScaled(clump.at, facing, clump.radius * 0.9), normal: facing, size: clamp(clump.radius / (base * 1.2), 0, 1) });
    }
  });
  return { parts: [out.part()], anchors };
}
