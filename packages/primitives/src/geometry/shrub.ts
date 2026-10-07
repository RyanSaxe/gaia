// Shrubs: many stems from one root crown, and layered leaf cards that hug the
// frame down to the ground, so a bush reads as one soft, leafy mound rather
// than a small tree. Berries come from blossoms@1 on the mound's anchors.

import { type Anchor, type BuildContext, type Built, CUT, type Limb, type Resolved, type Skeleton, type Vec3 } from "@gaia/schema";
import type { leafMoundParams, thicketParams } from "../flora.ts";
import {
  type CardPoint,
  type Channels,
  PartBuilder,
  type V3,
  add,
  addScaled,
  basis,
  clamp,
  cross,
  cutOf,
  emitCard,
  fbm3,
  icosphere,
  lerp,
  lossThreshold,
  normalize,
  scale,
} from "./kit.ts";

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

/**
 * How each kind of leaf builds a mound: its cut, its cards' size, length and
 * share, how lumpy its clumps are and how bright. Feathery sprays are long,
 * tapering cards of fine needles combed toward their tips.
 */
const LEAVES = {
  rounded: { cut: CUT.oval, card: 1, long: 1, cards: 1, lump: 0.24, shade: 0 },
  glossy: { cut: CUT.oval, card: 0.82, long: 1, cards: 1.2, lump: 0.14, shade: 0.06 },
  feathery: { cut: CUT.needles, card: 0.7, long: 2.2, cards: 0.8, lump: 0.34, shade: -0.12 },
} as const;

/** A bush is placed by the hundred, so its mound stays small. */
const MOUND_TRIANGLE_BUDGET = 8_500;
/** Cards deeper in the mound than this are hidden by the clumps around them, so they are never built. */
const HIDDEN = 0.6;

/**
 * Leaf cards layered over clumps at every tip and along the stems, shaded as
 * one rounded volume that sits on the ground: brighter on top and at the
 * rim, darker underneath and inside, over a dark core that hides the frame.
 * As vitality falls the cards drop one by one and brown, the core goes, and
 * bare twigs show through.
 */
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
  const outward = (q: Vec3): { dir: V3; depth: number } => {
    const d: V3 = [(q[0] - center[0]) / radius[0], (q[1] - center[1]) / radius[1], (q[2] - center[2]) / radius[2]];
    return { dir: normalize(d), depth: Math.hypot(d[0], d[1], d[2]) };
  };
  const base = clamp(Math.min(reach, top) * 0.42, 0.14, 1) * (0.75 + 0.35 * p.fullness);

  interface Clump {
    readonly at: V3;
    readonly pivot: Vec3;
    readonly radius: number;
  }
  const clumps: Clump[] = tips.map((t, i) => {
    const cr = r.fork(`tip${i}`);
    const rad = base * (0.7 + 0.4 * t.size) * cr.range(0.75, 1.25);
    const at = addScaled(t.position, t.normal, rad * 0.15);
    at[1] = Math.max(at[1], rad * 0.55);
    return { at, pivot: t.position, radius: rad };
  });
  // Fill along the stems, so the mound is full from inside.
  const fill = Math.round(tips.length * Math.max(0, p.fullness - 0.25) * 1.4);
  for (let i = 0; i < fill && skel.limbs.length > 0; i++) {
    const fr = r.fork(`fill${i}`);
    const limb = skel.limbs[Math.floor(fr.next() * skel.limbs.length)] as Limb;
    const at = lerp(limb.start, limb.end, fr.range(0.45, 1));
    const rad = base * fr.range(0.8, 1.1);
    at[1] = Math.max(at[1], rad * 0.5);
    clumps.push({ at, pivot: limb.end, radius: rad });
  }

  // A dark core fills the mound, so the frame never shows through the
  // leaves and gaps between cards read as shadow inside the bush.
  const core = icosphere(2);
  const coreSeed = Math.floor(r.fork("core").next() * 1e6);
  const coreFirst = out.vertexCount;
  const coreRadius: V3 = [reach * 0.72, top * 0.44, reach * 0.72];
  for (const n of core.points) {
    const lump = 1 + 0.2 * fbm3(n[0] * 2.2, n[1] * 2.2, n[2] * 2.2, coreSeed, 3);
    const down = n[1] < 0 ? Math.min(coreRadius[1], center[1] - 0.02) : coreRadius[1];
    const q: V3 = [center[0] + n[0] * coreRadius[0] * lump, Math.max(0.02, center[1] + n[1] * down * lump), center[2] + n[2] * coreRadius[2] * lump];
    out.vertex(q, normalize(lerp(n, [0, 1, 0], 0.3)), 0.06 + 0.16 * (n[1] * 0.5 + 0.5) + look.shade, {
      loss: clamp(0.22 + 0.06 * fbm3(n[0] * 3, n[1] * 3, n[2] * 3, coreSeed + 1, 2), 0.05, 0.32),
      droop: 0.25,
      wither: 0.85,
      glow: 0,
      pivot: [0, 0.05, 0],
      tint: 0.02 * fbm3(n[0] * 1.3, n[1] * 1.3, n[2] * 1.3, coreSeed + 2, 2),
    });
  }
  for (const [a, b, c] of core.triangles) out.triangle(coreFirst + a, coreFirst + b, coreFirst + c);

  const anchors: Anchor[] = [];
  const cardHalf = (rad: number): number => (0.07 + 0.1 * rad) * look.card;
  const cardsFor = (rad: number): number => Math.round(clamp(6 * (rad / cardHalf(rad)) ** 2 * look.cards / look.long, 10, 70));
  // Cards are two triangles each; a crowded frame thins every clump's cards evenly to stay in budget.
  const wanted = clumps.reduce((n, c) => n + cardsFor(c.radius) * 1.3, 0);
  const thin = Math.min(1, (MOUND_TRIANGLE_BUDGET - core.triangles.length) / 2 / Math.max(1, wanted));
  clumps.forEach((clump, i) => {
    const cr = r.fork(`clump${i}`);
    const loss = lossThreshold(cr.next(), 0.65);
    const droop = 0.2 + 0.15 * cr.next();
    const wither = 0.75 + 0.25 * cr.next();
    const tint = cr.range(-0.07, 0.07);
    const seed = Math.floor(cr.next() * 1e6);
    const count = Math.round(cardsFor(clump.radius) * thin);
    // An outer layer for the leafy outline and an inner, darker one for depth.
    for (const layer of [
      { n: count, from: 0.85, to: 1.02, shade: 0 },
      { n: Math.round(count * 0.3), from: 0.5, to: 0.8, shade: -0.1 },
    ]) {
      for (let k = 0; k < layer.n; k++) {
        const y = 1 - (2 * (k + cr.range(0.2, 0.8))) / layer.n;
        const ring = Math.sqrt(Math.max(0, 1 - y * y));
        const phi = k * 2.39996 + cr.range(-0.4, 0.4);
        const dir: V3 = [Math.cos(phi) * ring, y, Math.sin(phi) * ring];
        const lump = 1 + look.lump * fbm3(dir[0] * 1.7 + seed * 0.013, dir[1] * 1.7, dir[2] * 1.7, seed, 3);
        const rad = clump.radius * lump * cr.range(layer.from, layer.to);
        // Clumps flatten a little underneath and never sink below the soil.
        const at: V3 = [clump.at[0] + dir[0] * rad, Math.max(0.03, clump.at[1] + dir[1] * rad * (dir[1] < 0 ? 0.75 : 0.92)), clump.at[2] + dir[2] * rad];
        const place = outward(at);
        if (place.depth < HIDDEN && layer.shade === 0 && at[1] > 0.15) continue;
        const half = cardHalf(clump.radius) * cr.range(0.8, 1.2);
        const out1 = normalize(lerp(dir, place.dir, 0.5));
        const [u, v] = basis(out1);
        const turn = cr.next() * Math.PI * 2;
        const tangent = add(scale(u, Math.cos(turn)), scale(v, Math.sin(turn)));
        const lean = cr.range(0.55, 1.25);
        const along = normalize(add(scale(out1, Math.cos(lean)), scale(tangent, Math.sin(lean))));
        const across = normalize(cross(along, out1));
        const normal = normalize(lerp(dir, place.dir, 0.65));
        const rim = clamp((place.depth - 0.45) / 0.6, 0, 1);
        const height = clamp(at[1] / top, 0, 1);
        const shade =
          0.14 + 0.32 * rim + 0.3 * height * height + 0.08 * dir[1] + 0.06 * (lump - 1) / Math.max(0.01, look.lump) + 0.5 * tint + look.shade + layer.shade + cr.range(-0.04, 0.05);
        const ch: Channels = {
          loss: clamp(loss + cr.range(-0.08, 0.08) + (layer.shade < 0 ? 0.05 : 0), 0.01, 0.95),
          droop,
          wither: clamp(wither + cr.range(-0.15, 0.1), 0, 1),
          glow: 0,
          pivot: clump.pivot,
          tint: clamp(tint * 0.4 + cr.range(-0.025, 0.025), -0.1, 0.1),
        };
        const length = half * look.long;
        const rows = [-1, 1].map((b) =>
          [-1, 1].map((a): CardPoint => ({
            // Skirt cards that would dip into the soil lie on it instead.
            p: atLeast(add(add(at, scale(across, a * half)), scale(along, b * length)), 0.01),
            across: a,
            // A needle spray runs from its base (0) to its tip (1); a cluster of leaves from -1 to 1.
            along: look.cut === CUT.needles ? (b + 1) / 2 : b,
            n: normal,
            shade,
          })),
        );
        emitCard(out, rows, cutOf(look.cut, cr.next()), ch);
      }
    }
    for (let k = 0; k < 3; k++) {
      const d = normalize([cr.range(-1, 1), cr.range(-0.1, 1), cr.range(-1, 1)]);
      const facing = normalize(lerp(d, outward(clump.at).dir, 0.6));
      anchors.push({ position: addScaled(clump.at, facing, clump.radius * 0.95), normal: facing, size: clamp(clump.radius / (base * 1.2), 0, 1) });
    }
  });
  return { parts: [out.part()], anchors };
}

const atLeast = (q: V3, y: number): V3 => [q[0], Math.max(y, q[1]), q[2]];
