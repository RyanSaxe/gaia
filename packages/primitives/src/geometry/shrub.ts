// Shrubs: many stems from one root crown, and twigs carrying sprays of leaves
// that fill the frame down to the ground, so a bush reads as one soft, leafy
// mound rather than a small tree, built as a tree's crown is. Berries and
// flowers come from blossoms@1 on the anchors its twigs leave.

import { type Anchor, type BuildContext, type Built, CUT, type Limb, type Resolved, type Skeleton } from "@gaia/schema";
import type { leafMoundParams, thicketParams } from "../flora.ts";
import { PartBuilder, type V3, addScaled, clamp, lerp, normalize } from "./kit.ts";
import { Boughs, type Clump, type ClumpLook, type Crown, emitClump } from "./foliage.ts";

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
 * How each kind of leaf builds a mound: its spray's cut and size, and how
 * many twigs fill a clump. Feathery sprays are long needle sprays combed
 * toward their tips.
 */
const LEAVES = {
  rounded: { cut: CUT.oval, half: 0.13, twigs: 30 },
  glossy: { cut: CUT.oval, half: 0.11, twigs: 38 },
  feathery: { cut: CUT.needles, half: 0.12, twigs: 26 },
} as const;

/** A bush is placed by the hundred, so its mound stays small. */
const MOUND_TRIANGLE_BUDGET = 8_500;
/** Each twig is a three-sided tube in two segments and a fork in one, with five sprays and a fork's three: 18 + 2 * 8. */
const TRIANGLES_PER_TWIG = 34;

/**
 * A bush's leaves: at every stem tip, and along the stems for a full mound,
 * a clump of twigs that leave the stem and curve out to the mound's surface
 * with sprays of leaves along them, down to the soil. The mound shades as
 * one rounded volume, bright on top and at the rim, darker inside, where the
 * stems show in its shade. Each twig sways with its stem and bends about
 * where it leaves it; as vitality falls the leaves brown and drop in place,
 * and bare twigs stand.
 */
export function buildLeafMound(p: Resolved<typeof leafMoundParams>, ctx: BuildContext, skel: Skeleton): Built {
  const r = ctx.rand.fork("mound");
  const look = LEAVES[p.leaves];
  const boughs = new Boughs(skel);
  let top = 0.3;
  let reach = 0.3;
  for (const t of skel.tips) {
    top = Math.max(top, t.position[1]);
    reach = Math.max(reach, Math.hypot(t.position[0], t.position[2]));
  }
  // The mound's volume, which shades its sprays as one.
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
  const clumpLook: ClumpLook = { twigs: look.twigs * (0.7 + 0.5 * p.fullness), sprays: 5, half: look.half * (0.8 + 0.4 * base), cut: look.cut, shape: "round", ground: 0.02 };
  // A crowded frame thins every clump's twigs evenly to stay in budget.
  const wanted = clumps.reduce((n, c) => n + Math.max(4, Math.round(clumpLook.twigs * c.radius * c.radius)), 0) * TRIANGLES_PER_TWIG;
  const density = Math.min(1, MOUND_TRIANGLE_BUDGET / Math.max(1, wanted));
  const leaf = new PartBuilder("leaf");
  const twigs = new PartBuilder("bark");
  const anchors: Anchor[] = [];
  for (const clump of clumps) emitClump(leaf, twigs, anchors, mound, boughs, clump, clumpLook, density);
  return { parts: [twigs.part(), leaf.part()], anchors };
}
