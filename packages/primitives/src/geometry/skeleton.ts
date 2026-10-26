// Skeleton growth. Each branch draws from its own forked stream, so growing
// more in one branch never shifts another.

import type { Anchor, BuildContext, Limb, Rand, Resolved, Skeleton } from "@gaia/schema";
import type { branchingParams, saplingParams, spireParams } from "../flora.ts";
import { type V3, addScaled, basis, lerp, normalize, rotate } from "./kit.ts";

type Habit = Resolved<typeof branchingParams>["habit"];

interface HabitShape {
  /** Fraction of the height spent on the bare trunk. */
  readonly trunk: number;
  /** The first child continues the parent's line. */
  readonly leader: boolean;
  /** Upward pull added to each child's direction. */
  readonly tropism: number;
  readonly ratio: number;
  readonly spread: number;
  /** Downward bend per depth along each branch, for weeping forms. */
  readonly arch: number;
  readonly girth: number;
  readonly firstSplit: number;
}

const HABITS: Readonly<Record<Habit, HabitShape>> = {
  upright: { trunk: 0.34, leader: true, tropism: 0.35, ratio: 0.74, spread: 1, arch: 0, girth: 0.05, firstSplit: 3 },
  spreading: { trunk: 0.3, leader: false, tropism: 0.08, ratio: 0.8, spread: 1.15, arch: 0, girth: 0.05, firstSplit: 4 },
  weeping: { trunk: 0.42, leader: false, tropism: 0.05, ratio: 0.82, spread: 1.35, arch: 1, girth: 0.04, firstSplit: 5 },
  columnar: { trunk: 0.2, leader: true, tropism: 0.7, ratio: 0.7, spread: 0.45, arch: 0, girth: 0.04, firstSplit: 3 },
};

interface Grown {
  readonly start: V3;
  readonly end: V3;
  readonly depth: number;
  readonly parent: number;
  /** The branch this segment belongs to; a branch is a short chain of segments. */
  readonly chain: number;
  readonly terminal: boolean;
}

const UP: V3 = [0, 1, 0];
const DEG = Math.PI / 180;

/** Recursive splitting, then fitted so height over width matches `stature`. */
export function growBranching(p: Resolved<typeof branchingParams>, ctx: BuildContext): Skeleton {
  const habit = HABITS[p.habit];
  const s = ctx.facts.scale ?? 1;
  const height = 7 * s * Math.pow(p.stature / 1.1, 0.45);
  const width = height / p.stature;
  const levels = Math.floor(p.density);
  const extraSplit = p.density - levels;
  const spread = p.spread * DEG * habit.spread;
  const segs: Grown[] = [];
  const chainTips: number[] = [];
  const chainParent: number[] = [];

  const frame = ctx.rand.fork("frame");
  const trunkRand = frame.fork("trunk");
  const trunkLength = height * habit.trunk;

  // The trunk: three gently wandering segments.
  let at: V3 = [0, 0, 0];
  let dir: V3 = [0, 1, 0];
  let parent = -1;
  chainTips.push(0);
  chainParent.push(-1);
  for (let i = 0; i < 3; i++) {
    dir = normalize([dir[0] + trunkRand.range(-0.07, 0.07), 1, dir[2] + trunkRand.range(-0.07, 0.07)]);
    const end = addScaled(at, dir, trunkLength / 3);
    segs.push({ start: at, end, depth: 0, parent, chain: 0, terminal: false });
    parent = segs.length - 1;
    at = end;
  }

  const grow = (r: Rand, start: V3, d: V3, len: number, depth: number, parentSeg: number, parentChain: number): void => {
    const chain = chainTips.length;
    chainTips.push(0);
    chainParent.push(parentChain);
    const segments = depth === 1 ? 3 : 2;
    let here = start;
    let heading = d;
    let prev = parentSeg;
    const willSplit = depth < levels || (depth === levels && r.next() < extraSplit);
    for (let k = 0; k < segments; k++) {
      if (habit.arch > 0) {
        const bend = habit.arch * (depth === 1 ? 0.16 : 0.24 + 0.1 * depth) * ((k + 1) / segments);
        heading = normalize([heading[0] * 1.05, heading[1] - bend, heading[2] * 1.05]);
      }
      heading = normalize(addScaled(heading, [r.range(-0.12, 0.12), r.range(-0.08, 0.08), r.range(-0.12, 0.12)], 1));
      const end = addScaled(here, heading, len / segments);
      const terminal = !willSplit && k === segments - 1;
      segs.push({ start: here, end, depth, parent: prev, chain, terminal });
      prev = segs.length - 1;
      here = end;
    }
    if (!willSplit) {
      for (let c = chain; c >= 0; c = chainParent[c] ?? -1) chainTips[c] = (chainTips[c] ?? 0) + 1;
      return;
    }
    split(r, here, heading, len, depth, prev, chain);
  };

  const split = (r: Rand, at: V3, heading: V3, len: number, depth: number, prev: number, chain: number): void => {
    const n = depth === 0 ? habit.firstSplit : 2 + (r.next() < 0.45 ? 1 : 0);
    const [u, v] = basis(heading);
    const phase = r.next() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const cr = r.fork(`c${i}`);
      const az = phase + (i / n) * Math.PI * 2 + cr.range(-0.35, 0.35);
      const axis = normalize([
        u[0] * Math.cos(az) + v[0] * Math.sin(az),
        u[1] * Math.cos(az) + v[1] * Math.sin(az),
        u[2] * Math.cos(az) + v[2] * Math.sin(az),
      ]);
      const isLeader = habit.leader && i === 0;
      const angle = isLeader ? spread * 0.2 : spread * cr.range(0.8, 1.2) * (depth === 0 ? 1.15 : 1);
      let childDir = rotate(heading, axis, angle);
      const pull = habit.arch > 0 && depth >= 1 ? 0 : habit.tropism;
      childDir = normalize(addScaled(childDir, UP, pull * 0.6));
      // Weeping limbs never turn back upward once they arch over.
      if (habit.arch > 0 && depth >= 1) childDir = normalize([childDir[0], Math.min(childDir[1], heading[1] * 0.6 + 0.1), childDir[2]]);
      const childLen = len * habit.ratio * (isLeader ? 1.05 : cr.range(0.82, 1.08));
      grow(cr, at, childDir, childLen, depth + 1, prev, chain);
    }
  };

  split(frame.fork("crown"), at, dir, ((height - trunkLength) * 0.62) / habit.ratio, 0, parent, 0);

  // Fit to the declared proportions around the fork, so the trunk itself
  // only stretches upward and never leans further than it grew.
  const fork = at;
  let top = 0;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const g of segs) {
    for (const q of [g.start, g.end]) {
      top = Math.max(top, q[1]);
      minX = Math.min(minX, q[0] - fork[0]);
      maxX = Math.max(maxX, q[0] - fork[0]);
      minZ = Math.min(minZ, q[2] - fork[2]);
      maxZ = Math.max(maxZ, q[2] - fork[2]);
    }
  }
  const grownWidth = Math.max(0.01, (maxX - minX + maxZ - minZ) / 2);
  const fx = Math.min(1.6, Math.max(0.6, width / grownWidth));
  const fy = height / Math.max(0.01, top);
  // Limbs that arch down level out softly above the ground, never into it.
  const above = (y: number): number => (y >= 0.6 ? y : 0.6 - 0.35 * (1 - Math.exp((y - 0.6) / 0.35)));
  const fit = (q: V3, trunk: boolean): V3 =>
    trunk ? [q[0], q[1] * fy, q[2]] : [fork[0] + (q[0] - fork[0]) * fx, above(q[1] * fy), fork[2] + (q[2] - fork[2]) * fx];

  // Pipe model: a branch's radius follows how many tips it carries.
  const totalTips = Math.max(1, chainTips[0] ?? 1);
  const baseRadius = height * habit.girth * Math.pow(3 / p.density, 0.3);
  const chainRadius = (c: number): number => baseRadius * Math.sqrt((chainTips[c] ?? 1) / totalTips);
  const members = new Map<number, number[]>();
  segs.forEach((g, i) => {
    const list = members.get(g.chain) ?? [];
    list.push(i);
    members.set(g.chain, list);
  });

  const limbs: Limb[] = segs.map((g, i) => {
    const chain = members.get(g.chain) ?? [i];
    const k = chain.indexOf(i);
    const r0 = chainRadius(g.chain);
    const tail = g.terminal || chain.some((m) => segs[m]?.terminal) ? 0.35 : 0.8;
    const along = (f: number): number => r0 * (1 - (1 - tail) * f);
    return {
      start: fit(g.start, g.depth === 0),
      end: fit(g.end, g.depth === 0),
      startRadius: g.depth === 0 && k === 0 ? r0 * 1.12 : along(k / chain.length),
      endRadius: along((k + 1) / chain.length),
      depth: g.depth,
      parent: g.parent,
    };
  });

  const tips: Anchor[] = [];
  limbs.forEach((l, i) => {
    if (segs[i]?.terminal !== true) return;
    const out = normalize([l.end[0] - l.start[0], l.end[1] - l.start[1], l.end[2] - l.start[2]]);
    tips.push({ position: l.end, normal: out, size: 1 });
  });
  return { limbs, tips };
}

type SaplingHabit = Resolved<typeof saplingParams>["habit"];

/**
 * How a young tree carries its tiers: its width for its height, where its
 * lowest tier leaves the stem, branches per tier, how far each branch rises
 * above level (radians), and how far the stem leans toward the light.
 */
const SAPLING: Readonly<Record<SaplingHabit, { width: number; low: number; perTier: number; rise: number; lean: number }>> = {
  reaching: { width: 0.42, low: 0.38, perTier: 2, rise: 0.85, lean: 0.03 },
  tiered: { width: 0.62, low: 0.22, perTier: 4, rise: 0.12, lean: 0.01 },
  leaning: { width: 0.55, low: 0.32, perTier: 2, rise: 0.5, lean: 0.16 },
};

/**
 * A young tree: one thin stem to its top and a few tiers of slender
 * branches, shortest at the top, each with a side twig, so it reads as a
 * tree that will grow rather than a small grown one. It stands at its own
 * height, never the file's: a sapling is no taller than a person.
 */
export function growSapling(p: Resolved<typeof saplingParams>, ctx: BuildContext): Skeleton {
  const habit = SAPLING[p.habit];
  const r = ctx.rand.fork("sapling");
  const height = Math.min(1.8, p.stature);
  const width = height * habit.width;
  const stem = 0.006 + 0.012 * height;
  const limbs: Limb[] = [];
  const tips: Anchor[] = [];
  const lean = r.next() * Math.PI * 2;
  // The stem: six gently wandering segments, tapering to a whip at the top.
  const along: V3[] = [[0, 0, 0]];
  for (let i = 1; i <= 6; i++) {
    const f = i / 6;
    along.push([Math.cos(lean) * habit.lean * height * f * f + r.range(-0.012, 0.012), height * f, Math.sin(lean) * habit.lean * height * f * f + r.range(-0.012, 0.012)]);
  }
  for (let i = 0; i < 6; i++) {
    limbs.push({ start: along[i] as V3, end: along[i + 1] as V3, startRadius: stem * (1 - 0.8 * (i / 6)), endRadius: stem * (1 - 0.8 * ((i + 1) / 6)), depth: 0, parent: i - 1 });
  }
  tips.push({ position: along[6] as V3, normal: [0, 1, 0], size: 0.5 });
  const tiers = Math.max(1, Math.round(p.tiers));
  for (let k = 0; k < tiers; k++) {
    const tr = r.fork(`tier${k}`);
    const f = habit.low + (0.9 - habit.low) * (tiers === 1 ? 0.5 : k / (tiers - 1));
    const seg = Math.min(5, Math.floor(f * 6));
    const at = lerp(along[seg] as V3, along[seg + 1] as V3, f * 6 - seg);
    const count = habit.perTier + (tr.next() < 0.35 ? 1 : 0);
    for (let j = 0; j < count; j++) {
      const br = tr.fork(`branch${j}`);
      const az = k * 2.4 + (j / count) * Math.PI * 2 + br.range(-0.4, 0.4);
      const len = Math.max(0.1, (width / 2) * Math.pow(1 - (f - habit.low) / (1.05 - habit.low), 0.7) * br.range(0.8, 1.15) + 0.06);
      const up = habit.rise + br.range(-0.12, 0.12);
      const d1 = normalize([Math.cos(az) * Math.cos(up), Math.sin(up), Math.sin(az) * Math.cos(up)]);
      // The outer half bends: up toward the light on a reaching sapling, a little down on a tiered one.
      const d2 = normalize(addScaled(d1, UP, habit.rise > 0.4 ? 0.25 : -0.2));
      const mid = addScaled(at, d1, len * 0.55);
      const end = addScaled(mid, d2, len * 0.45);
      const r0 = Math.max(0.003, stem * 0.42 * Math.pow(len / (width / 2 + 0.06), 0.5));
      limbs.push({ start: at, end: mid, startRadius: r0, endRadius: r0 * 0.65, depth: 1, parent: seg });
      const first = limbs.length - 1;
      limbs.push({ start: mid, end, startRadius: r0 * 0.65, endRadius: r0 * 0.3, depth: 1, parent: first });
      tips.push({ position: end, normal: d2, size: 0.6 + 0.4 * Math.min(1, len / (width / 2 + 0.06)) });
      // One side twig from the middle, so a branch carries leaves along its length.
      const side = normalize(rotate(d1, UP, br.range(0.55, 0.9) * (br.next() < 0.5 ? -1 : 1)));
      const twigEnd = addScaled(mid, normalize(addScaled(side, UP, 0.2)), len * 0.4);
      limbs.push({ start: mid, end: twigEnd, startRadius: r0 * 0.4, endRadius: r0 * 0.18, depth: 2, parent: first });
      tips.push({ position: twigEnd, normal: side, size: 0.45 });
    }
  }
  return { limbs, tips };
}

/**
 * A spire grows this many whorls for each ring Jev asks for, so its levels
 * stand close enough that needles fill the sky between them, while a sparse
 * spire stays sparser than a dense one.
 */
const WHORLS_PER_RING = 1.4;

/** A straight leader with whorls of limbs, shaped as a cone of the declared proportions. */
export function growSpire(p: Resolved<typeof spireParams>, ctx: BuildContext): Skeleton {
  const s = ctx.facts.scale ?? 1;
  const height = 9 * s * Math.pow(p.stature / 2.2, 0.35);
  const width = height / p.stature;
  const frame = ctx.rand.fork("frame");
  const limbs: Limb[] = [];
  const tips: Anchor[] = [];
  const baseRadius = height * 0.032;

  // The leader.
  const leaderRand = frame.fork("leader");
  const trunkSegs = 6;
  const trunkTop = height * 0.98;
  let at: V3 = [0, 0, 0];
  const trunkIndex: number[] = [];
  for (let i = 0; i < trunkSegs; i++) {
    const f0 = i / trunkSegs;
    const f1 = (i + 1) / trunkSegs;
    const end: V3 = [leaderRand.range(-0.03, 0.03) * s, trunkTop * f1, leaderRand.range(-0.03, 0.03) * s];
    limbs.push({
      start: at,
      end,
      startRadius: baseRadius * (i === 0 ? 1.12 : 1 - 0.85 * f0),
      endRadius: baseRadius * (1 - 0.85 * f1),
      depth: 0,
      parent: i === 0 ? -1 : limbs.length - 1,
    });
    trunkIndex.push(limbs.length - 1);
    at = end;
  }
  tips.push({ position: at, normal: [0, 1, 0], size: 0.6 });

  const whorls = Math.max(2, Math.round(p.whorls * WHORLS_PER_RING));
  const low = height * 0.16;
  const high = height * 0.9;
  for (let w = 0; w < whorls; w++) {
    const wr = frame.fork(`whorl${w}`);
    const t = w / (whorls - 1);
    const y = low + (high - low) * t + wr.range(-0.15, 0.15) * ((high - low) / whorls);
    const cone = (width / 2) * Math.pow(Math.max(0.05, 1 - (y - low * 0.5) / (height - low * 0.5)), 0.95);
    const count = t > 0.8 ? 4 : 5 + (wr.next() < 0.5 ? 1 : 0);
    const phase = w * 2.4 + wr.next();
    const onTrunk = trunkIndex[Math.min(trunkSegs - 1, Math.floor((y / trunkTop) * trunkSegs))] ?? 0;
    for (let j = 0; j < count; j++) {
      const lr = wr.fork(`limb${j}`);
      const az = phase + (j / count) * Math.PI * 2 + lr.range(-0.25, 0.25);
      const len = Math.max(0.25 * s, cone * lr.range(0.85, 1.1));
      const h: V3 = [Math.cos(az), 0, Math.sin(az)];
      const d1 = normalize([h[0], 0.1 - p.droop * 0.7, h[2]]);
      const d2 = normalize([h[0], 0.1 - p.droop * 1.6, h[2]]);
      const r0 = Math.max(0.025 * s, baseRadius * 0.32 * Math.pow(len / (width / 2), 0.6));
      const start: V3 = [0, y, 0];
      const mid = addScaled(start, d1, len * 0.6);
      const end = addScaled(mid, d2, len * 0.4);
      limbs.push({ start, end: mid, startRadius: r0, endRadius: r0 * 0.6, depth: 1, parent: onTrunk });
      const first = limbs.length - 1;
      limbs.push({ start: mid, end, startRadius: r0 * 0.6, endRadius: r0 * 0.25, depth: 1, parent: first });
      tips.push({ position: end, normal: d2, size: 0.5 + 0.5 * Math.min(1, len / (width / 2)) });
      for (const [k, side] of [[0, 1], [1, -1]] as const) {
        const along = k === 0 ? 0.45 : 0.75;
        const base = along < 0.6 ? addScaled(start, d1, len * along) : addScaled(mid, d2, len * (along - 0.6));
        const twigDir = normalize(rotate([h[0], d1[1] - 0.1, h[2]], UP, side * lr.range(0.6, 0.95)));
        const twigEnd = addScaled(base, twigDir, len * 0.35);
        limbs.push({
          start: base,
          end: twigEnd,
          startRadius: r0 * 0.35,
          endRadius: r0 * 0.12,
          depth: 2,
          parent: along < 0.6 ? first : first + 1,
        });
        tips.push({ position: twigEnd, normal: twigDir, size: 0.35 });
      }
    }
  }
  return { limbs, tips };
}
