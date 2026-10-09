// Shrubs: many stems from one root crown, leafy to the ground, so a bush
// reads as one leafy mass rather than a small tree. Its leaves grow in
// crowded clusters on short twigs from its stems, at several depths, with a
// ragged outline; scrub grows clusters only at its tips. Berries and flowers
// come from blossoms@1 on the anchors its twigs leave.

import { type Anchor, type BuildContext, type Built, CUT, type Limb, type Resolved, type Skeleton } from "@gaia/schema";
import type { leafMoundParams, thicketParams } from "../flora.ts";
import { type Channels, PartBuilder, type V3, add, addScaled, clamp, cross, dot, fbm3, length, lerp, normalize, scale, sub } from "./kit.ts";
import { Boughs, type Clump, type ClumpLook, type Crown, emitClump, emitSpray, emitTwig } from "./foliage.ts";

const HABITS = {
  mound: { width: 1.25, rise: 0.55, lift: 0.12 },
  spreading: { width: 2, rise: 0.35, lift: 0.06 },
  vase: { width: 0.95, rise: 0.85, lift: 0.3 },
} as const;

const UP: V3 = [0, 1, 0];

/** Stems from the root crown out to tips spread over a dome, plus low tips so leaves reach the ground; or, for scrub, a low wiry tangle. */
export function growThicket(p: Resolved<typeof thicketParams>, ctx: BuildContext): Skeleton {
  if (p.habit === "scrub") return growScrub(p, ctx);
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

/** Scrub: low, wiry stems that lean out from the root, fork two or three times and arch over, some twigs running on past the forks. */
function growScrub(p: Resolved<typeof thicketParams>, ctx: BuildContext): Skeleton {
  const r = ctx.rand.fork("scrub");
  const s = ctx.facts.scale ?? 1;
  const height = Math.min(1.2, p.stature * 0.75 * (0.8 + 0.2 * s));
  const width = height * 2.4;
  const stems = Math.max(5, Math.round(p.stems * 1.6));
  const limbs: Limb[] = [];
  const tips: Anchor[] = [];
  const radius = 0.008 + 0.01 * height;
  for (let i = 0; i < stems; i++) {
    const sr = r.fork(`stem${i}`);
    const az = (i / stems) * Math.PI * 2 + sr.range(-0.5, 0.5);
    const lean = sr.range(0.35, 1.05);
    const len = height * sr.range(0.55, 1);
    const root: V3 = [Math.cos(az) * width * 0.05 * sr.next(), 0, Math.sin(az) * width * 0.05 * sr.next()];
    const mid: V3 = [root[0] + Math.cos(az) * Math.sin(lean) * len * 0.5, len * Math.cos(lean) * 0.7 + 0.04, root[2] + Math.sin(az) * Math.sin(lean) * len * 0.5];
    const stem = limbs.length;
    limbs.push({ start: root, end: mid, startRadius: radius, endRadius: radius * 0.7, depth: 0, parent: -1 });
    const forks = 2 + (sr.next() < 0.5 ? 1 : 0);
    for (let k = 0; k < forks; k++) {
      const fr = sr.fork(`fork${k}`);
      const faz = az + fr.range(-0.8, 0.8);
      const flen = len * fr.range(0.45, 0.75);
      const end: V3 = [mid[0] + Math.cos(faz) * flen, Math.max(0.08, mid[1] + flen * fr.range(-0.15, 0.45)), mid[2] + Math.sin(faz) * flen];
      const fork = limbs.length;
      limbs.push({ start: mid, end, startRadius: radius * 0.6, endRadius: radius * 0.3, depth: 1, parent: stem });
      tips.push({ position: end, normal: normalize([end[0], 0.35, end[2]]), size: fr.range(0.5, 1) });
      if (fr.next() < 0.6) {
        const on: V3 = [end[0] + Math.cos(faz + 0.6) * flen * 0.4, Math.max(0.06, end[1] - flen * 0.15), end[2] + Math.sin(faz + 0.6) * flen * 0.4];
        limbs.push({ start: lerp(mid, end, 0.6), end: on, startRadius: radius * 0.35, endRadius: radius * 0.2, depth: 2, parent: fork });
        tips.push({ position: on, normal: normalize([on[0], 0.2, on[2]]), size: 0.6 });
      }
    }
  }
  return { limbs, tips };
}

/** A feathery shrub's needle sprays, built along twigs as a crown's are: the spray's cut, half width, and twigs per square meter of clump. */
const FEATHERY = { cut: CUT.needles, half: 0.12, twigs: 26 } as const;
/** A crowded cluster's half width, by leaf. */
const CROWDED_HALF = { rounded: 0.108, glossy: 0.095 } as const;

/**
 * How a bush lays its clusters: how many a full bush shows and how many ride
 * each twig; the depths twigs reach into a clump (a share of its radius) and
 * each depth's share; cluster size at the rim and deep inside; and its ragged
 * outline: how lumpy each clump is, how much clump sizes vary, the share of
 * twigs that stray past a clump, and how much of the rim is notched away.
 */
const MOUND = {
  clusters: 1250,
  perTwig: 5,
  layers: [[1, 0.5], [0.8, 0.3], [0.6, 0.2]] as readonly (readonly [number, number])[],
  rim: 0.85,
  inside: 1.3,
  lumps: 0.3,
  spread: 0.4,
  strays: 0.08,
  notches: 0.5,
};
/** Scrub's tufts: clusters only at its tips, each tuft this wide, this share of tips bare. */
const TUFTS = { ...MOUND, clusters: 750, perTwig: 4, radius: 0.2, bare: 0.25, strays: 0.05, notches: 0.2 };
/** Below this fullness ("in tufts at its tips"), clusters grow only at the frame's tips. */
const TUFTED = 0.25;
/** How far a cluster card reaches from its base, as a multiple of its size: along its direction (twice its reach, up to 1.15 times 1.15), and across it. */
const CARD_ALONG = 2.65;
const CARD_ACROSS = 1.15;
/** The lowest a leaf may reach above the soil, meters. */
const SOIL = 0.005;
/** Clusters drop evenly between these vitalities, the outer ones this much sooner and the inner this much later. */
const DROP = { from: 0.75, to: 0.25, rim: 0.05 } as const;

/** A bush is placed by the hundred, so its leaves and twigs stay small. */
const MOUND_TRIANGLE_BUDGET = 8_500;
/** A feathery twig is a three-sided tube in two segments and a fork in one, with five sprays and a fork's three: 18 + 2 * 8. */
const TRIANGLES_PER_TWIG = 34;
/** A cluster's twig is one segment, 6 triangles, and each cluster one card, 2. */
const CLUSTER_TWIG = 6;
const CLUSTER = 2;

/**
 * A bush's leaves. Rounded and glossy bushes grow crowded leaf clusters
 * (`CUT.crowded`) on short twigs from their stems: over clumps at every stem
 * tip and along the stems, at three depths, small at the rim and larger
 * inside, faced out and up so few are seen edge-on, with a ragged outline of
 * uneven clumps, notches and a few stray twigs. Leaves alone fill the bush;
 * nothing dark stands inside it. Scrub ("in tufts at its tips") grows
 * clusters only at most of its tips. A feathery bush keeps its needle sprays.
 * Every cluster hangs from its twig, each twig ends under its outermost
 * cluster, and each bends with its stem and about where it leaves it; as
 * vitality falls the clusters brown and drop in place, and bare stems and
 * twigs stand.
 */
export function buildLeafMound(p: Resolved<typeof leafMoundParams>, ctx: BuildContext, skel: Skeleton): Built {
  if (p.leaves === "feathery") return buildNeedleMound(p, ctx, skel);
  const r = ctx.rand.fork("mound");
  const boughs = new Boughs(skel);
  const { top, reach } = extentOf(skel);
  // The mound's volume, which shades its clusters as one.
  const mound: Crown = { center: [0, top * 0.45, 0], radius: [reach, top * 0.6, reach] };
  const tufts = p.fullness < TUFTED;
  const look = tufts ? TUFTS : MOUND;
  const half = CROWDED_HALF[p.leaves];
  const base = clamp(Math.min(reach, top) * 0.45, 0.16, 1) * (0.8 + 0.3 * p.fullness);
  const clumps = clumpsOf(skel, boughs, p, r.fork("clumps"), base, tufts);
  const surface = clumps.reduce((n, c) => n + c.radius * c.radius, 0);
  const wanted = look.clusters * (0.8 + 0.25 * Math.max(p.fullness, 0.45));
  // A crowded frame thins every clump's twigs evenly to stay in budget.
  const density = Math.min(1, MOUND_TRIANGLE_BUDGET / Math.max(1, (wanted / look.perTwig) * (CLUSTER_TWIG + look.perTwig * CLUSTER)));
  const leaf = new PartBuilder("leaf");
  const twigs = new PartBuilder("bark");
  const anchors: Anchor[] = [];
  const layerTotal = look.layers.reduce((n, [, w]) => n + w, 0);
  clumps.forEach((clump, ci) => {
    const cr = r.fork(`clump${ci}`);
    const limb = skel.limbs[clump.limb] as Limb;
    const count = Math.max(2, Math.round(((wanted * clump.radius * clump.radius) / surface / look.perTwig) * density));
    const tint = cr.range(-0.08, 0.08);
    const seed = Math.floor(cr.next() * 1e6);
    const lump = (d: V3): number => 1 + look.lumps * fbm3(d[0] * 1.4 + seed * 0.01, d[1] * 1.4, d[2] * 1.4, seed, 3);
    const notch = (d: V3): number => fbm3(d[0] * 0.9 + 7.3, d[1] * 0.9, d[2] * 0.9, seed + 11, 2);
    for (let k = 0; k < count; k++) {
      const tr = cr.fork(`twig${k}`);
      // Spread over the directions that do not face the soil.
      const y = 1 - (1.55 * (k + tr.range(0.2, 0.8))) / count;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = k * 2.39996 + tr.range(-0.4, 0.4);
      const d = normalize([Math.cos(phi) * ring, y, Math.sin(phi) * ring]);
      let pick = tr.next() * layerTotal;
      let depth = 1;
      for (const [at, w] of look.layers) {
        depth = at;
        if (pick < w) break;
        pick -= w;
      }
      const stray = tr.next() < look.strays;
      if (stray) depth = tr.range(1.2, 1.45);
      // Notches open gaps in the outline, never holes through it: only the outer layer is notched.
      if (depth >= 0.95 && !stray && notch(d) < -1 + 1.2 * look.notches) continue;
      const goal = addScaled(clump.center, d, clump.radius * depth * lump(d) * tr.range(0.92, 1.05));
      goal[1] = Math.max(goal[1], half * 1.4);
      let root = onLimb(limb, goal);
      if (length(sub(goal, root)) < 0.06) root = addScaled(goal, d, -0.08);
      const along = normalize(sub(goal, root));
      const b = boughs.at(clump.limb, root);
      // A cluster holds many leaves, so a tired bush must lose them steadily to read as tired:
      // clusters drop evenly from 0.75 down to 0.25, outer ones first, so about three in ten
      // have gone by 0.6, half by 0.5, and a failing bush stands bare.
      const loss = clamp(DROP.from - (DROP.from - DROP.to) * tr.next() + (depth >= 0.95 ? DROP.rim : -DROP.rim), 0.02, 0.9);
      const n = stray ? 2 : look.perTwig;
      const size = half * (look.inside + (look.rim - look.inside) * clamp((depth - 0.55) / 0.45, 0, 1));
      const ts = Array.from({ length: n }, (_, j) => 0.2 + 0.8 * ((j + tr.range(0.15, 0.85)) / n));
      const twigCh: Channels = { loss: 0, droop: b.droop, wither: 0.5, glow: 0, pivot: root, bough: b.bough, twig: root };
      const tip = Math.max(...ts);
      emitTwig(twigs, [root, lerp(root, goal, tip)], 0.003, 0.0015, () => twigCh);
      for (const t of ts) {
        const at = lerp(root, goal, t);
        // A card reaches up to 2.65 of its size along its direction and 1.15 across it: none may dip into the soil.
        if (at[1] - CARD_ACROSS * size < SOIL) continue;
        const out = normalize([at[0] - clump.center[0], (at[1] - clump.center[1]) * 1.2, at[2] - clump.center[2]]);
        const jitter: V3 = [tr.range(-1, 1), tr.range(-0.6, 0.6), tr.range(-1, 1)];
        // Across the clump's surface, a little down its slope, faced out and up.
        const level = cross(out, UP);
        let downhill = length(level) < 0.15 ? normalize([jitter[0], 0, jitter[2]]) : normalize(cross(level, out));
        if (downhill[1] > 0) downhill = scale(downhill, -1);
        const dir = normalize(add(add(scale(downhill, 0.5), scale(along, 0.45)), add(scale(out, 0.2), scale(jitter, 0.25))));
        if (at[1] + Math.min(0, dir[1]) * CARD_ALONG * size - CARD_ACROSS * size < SOIL) dir[1] = Math.abs(dir[1]);
        const shallow = clamp(length(sub(at, clump.center)) / clump.radius, 0, 1);
        emitSpray(leaf, mound, at, dir, normalize(addScaled(out, UP, 0.45)), size * tr.range(0.85, 1.15), CUT.crowded, tr, {
          loss: clamp(loss + tr.range(-0.08, 0.08), 0.02, 0.9),
          droop: b.droop,
          wither: clamp(0.95 + tr.range(-0.05, 0.05), 0, 1),
          glow: 0,
          pivot: at,
          bough: b.bough,
          twig: root,
          tint: clamp(tint * 0.4 + tr.range(-0.03, 0.03), -0.1, 0.1),
        }, -0.16 * (1 - shallow));
      }
      // Flowers and berries hang among the outer clusters.
      if (depth >= 0.95) anchors.push({ position: lerp(root, goal, Math.min(0.9, tip)), normal: d, size: 1, carry: { bough: b.bough, twig: root, droop: b.droop } });
    }
  });
  return { parts: [twigs.part(), leaf.part()], anchors };
}

/** How tall a frame stands and how far its tips reach from its middle. */
function extentOf(skel: Skeleton): { top: number; reach: number } {
  let top = 0.3;
  let reach = 0.3;
  for (const t of skel.tips) {
    top = Math.max(top, t.position[1]);
    reach = Math.max(reach, Math.hypot(t.position[0], t.position[2]));
  }
  return { top, reach };
}

/** The point of `limb` nearest `q`. */
function onLimb(limb: Limb, q: V3): V3 {
  const ab = sub(limb.end, limb.start);
  const t = clamp(dot(sub(q, limb.start), ab) / Math.max(dot(ab, ab), 1e-9), 0, 1);
  return addScaled(limb.start, ab, t);
}

/** Clumps over a bush: one at every stem tip and more along the stems, their sizes uneven; or, for scrub, a tuft at most tips. */
function clumpsOf(skel: Skeleton, boughs: Boughs, p: Resolved<typeof leafMoundParams>, r: BuildContext["rand"], base: number, tufts: boolean): Clump[] {
  const out: Clump[] = [];
  skel.tips.forEach((t, i) => {
    const cr = r.fork(`tip${i}`);
    if (tufts && cr.next() < TUFTS.bare) return;
    const radius = (tufts ? TUFTS.radius : base * (0.75 + 0.35 * t.size)) * cr.range(1 - MOUND.spread, 1 + MOUND.spread);
    const center = addScaled(t.position, t.normal, radius * (tufts ? 0.35 : 0.1));
    center[1] = Math.max(center[1], radius * 0.6);
    out.push({ center, radius, limb: boughs.limbNear(t.position), r: cr });
  });
  if (tufts) return out;
  const fill = Math.round(skel.tips.length * Math.max(0, p.fullness - 0.2) * 1.2);
  for (let i = 0; i < fill && skel.limbs.length > 0; i++) {
    const fr = r.fork(`fill${i}`);
    const k = Math.floor(fr.next() * skel.limbs.length);
    const limb = skel.limbs[k] as Limb;
    const center = lerp(limb.start, limb.end, fr.range(0.5, 1));
    const radius = base * fr.range(0.8, 1.05) * fr.range(1 - MOUND.spread, 1 + MOUND.spread);
    center[1] = Math.max(center[1], radius * 0.6);
    out.push({ center, radius, limb: k, r: fr });
  }
  return out;
}

/**
 * A feathery bush's leaves: at every stem tip, and along the stems for a
 * full mound, a clump of twigs that leave the stem and curve out to the
 * mound's surface with needle sprays along them, down to the soil. Each twig
 * sways with its stem and bends about where it leaves it; as vitality falls
 * the needles brown and drop in place, and bare twigs stand.
 */
function buildNeedleMound(p: Resolved<typeof leafMoundParams>, ctx: BuildContext, skel: Skeleton): Built {
  const r = ctx.rand.fork("mound");
  const boughs = new Boughs(skel);
  const { top, reach } = extentOf(skel);
  const mound: Crown = { center: [0, top * 0.45, 0], radius: [reach, top * 0.6, reach] };
  const base = clamp(Math.min(reach, top) * 0.42, 0.14, 1) * (0.75 + 0.35 * p.fullness);
  const clumps: Clump[] = skel.tips.map((t, i) => {
    const cr = r.fork(`tip${i}`);
    const rad = base * (0.7 + 0.4 * t.size) * cr.range(0.75, 1.25);
    const at = addScaled(t.position, t.normal, rad * 0.15);
    at[1] = Math.max(at[1], rad * 0.55);
    return { center: at, radius: rad, limb: boughs.limbNear(t.position), r: cr };
  });
  // Fill along the stems, so the mound is full from inside.
  const fill = Math.round(skel.tips.length * Math.max(0, p.fullness - 0.25) * 1.4);
  for (let i = 0; i < fill && skel.limbs.length > 0; i++) {
    const fr = r.fork(`fill${i}`);
    const k = Math.floor(fr.next() * skel.limbs.length);
    const limb = skel.limbs[k] as Limb;
    const at = lerp(limb.start, limb.end, fr.range(0.45, 1));
    const rad = base * fr.range(0.8, 1.1);
    at[1] = Math.max(at[1], rad * 0.5);
    clumps.push({ center: at, radius: rad, limb: k, r: fr });
  }
  const clumpLook: ClumpLook = { twigs: FEATHERY.twigs * (0.7 + 0.5 * p.fullness), sprays: 5, half: FEATHERY.half * (0.8 + 0.4 * base), cut: FEATHERY.cut, shape: "round", ground: 0.02 };
  // A crowded frame thins every clump's twigs evenly to stay in budget.
  const wanted = clumps.reduce((n, c) => n + Math.max(4, Math.round(clumpLook.twigs * c.radius * c.radius)), 0) * TRIANGLES_PER_TWIG;
  const density = Math.min(1, MOUND_TRIANGLE_BUDGET / Math.max(1, wanted));
  const leaf = new PartBuilder("leaf");
  const twigs = new PartBuilder("bark");
  const anchors: Anchor[] = [];
  for (const clump of clumps) emitClump(leaf, twigs, anchors, mound, boughs, clump, clumpLook, density);
  return { parts: [twigs.part(), leaf.part()], anchors };
}
