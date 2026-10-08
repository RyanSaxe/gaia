// Surfaces, foliage and ornaments. Every vertex carries its vitality
// response and what carries it: a leaf hangs on a stalk on a twig on a limb,
// sags with its bough and bends with it in the wind, and drops in place as
// vitality falls. Limbs and twigs never vanish, so a failing tree stands as
// bare twigs; only pods glow.

import { type Anchor, type BuildContext, type Built, CUT, type Limb, type Rand, type Resolved, type Skeleton, type Vec3 } from "@gaia/schema";
import type { barkParams, blossomsParams, leafClumpsParams, leafStrandsParams, needlesParams } from "../flora.ts";
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
  dot,
  emitCard,
  fbm3,
  icosphere,
  length,
  lerp,
  lossThreshold,
  normalize,
  rotate,
  scale,
  sub,
} from "./kit.ts";

const UP: V3 = [0, 1, 0];
/** A crown's heart: solid, drawn as the shade between its leaves. */
const CORE: V3 = [0, 0, CUT.core];

/** The foliage volume's center and half-extents, from the frame's tips. */
export interface Crown {
  readonly center: V3;
  readonly radius: V3;
}

export function crownOf(points: readonly Vec3[]): Crown {
  if (points.length === 0) return { center: [0, 1, 0], radius: [1, 1, 1] };
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const center: V3 = [cx / points.length, cy / points.length, cz / points.length];
  let rh = 0.5, rv = 0.5;
  for (const p of points) {
    rh = Math.max(rh, Math.hypot(p[0] - center[0], p[2] - center[2]));
    rv = Math.max(rv, Math.abs(p[1] - center[1]));
  }
  return { center, radius: [rh, rv, rh] };
}

/** Where a point sits in the crown: direction outward and depth, 0 at the center, 1 at the rim. */
function crownPlace(c: Crown, p: Vec3): { out: V3; depth: number } {
  const q: V3 = [(p[0] - c.center[0]) / c.radius[0], (p[1] - c.center[1]) / c.radius[1], (p[2] - c.center[2]) / c.radius[2]];
  return { out: normalize(q), depth: length(q) };
}

/** Blends a surface normal toward the crown's outward direction, so a canopy shades as one soft volume. */
const blendNormal = (n: Vec3, out: Vec3, k: number): V3 => normalize(lerp(n, out, k));

/** Mean distance from each point to its nearest neighbor. */
function meanNearest(points: readonly Vec3[]): number {
  if (points.length < 2) return 1;
  let sum = 0;
  for (const a of points) {
    let best = Infinity;
    for (const b of points) {
      if (a === b) continue;
      best = Math.min(best, length(sub(a, b)));
    }
    sum += best;
  }
  return sum / points.length;
}

const maxDepthOf = (s: Skeleton): number => s.limbs.reduce((m, l) => Math.max(m, l.depth), 0);

/**
 * What carries each limb: the joint its bough leaves the trunk at, and how
 * far it droops at a point, by the bark's rule. The trunk is the frame's
 * limb rising from the copy's base and the limbs that continue it at depth 0; a bough is
 * everything that leaves the trunk, and a stem from the ground (a shrub's)
 * is a bough of its own. Everything that grows from a bough (its limbs,
 * twigs, leaves and flowers) takes the bough's joint and its droop where it
 * grows, so a sagging or swaying bough carries all of it and nothing parts
 * from what holds it.
 */
export class Boughs {
  readonly #roots: number[];
  readonly #trunk: boolean[];
  readonly #reach = new Map<number, number>();
  constructor(readonly skel: Skeleton) {
    const limbs = skel.limbs;
    this.#trunk = limbs.map(() => false);
    limbs.forEach((l, i) => {
      const up = limbs[l.parent];
      // A trunk rises from the copy's base; a stem rooted beside it is a bough.
      this.#trunk[i] = l.depth === 0 && (up === undefined ? Math.hypot(l.start[0], l.start[2]) < 0.01 : (this.#trunk[l.parent] ?? false));
    });
    this.#roots = limbs.map((l, i) => {
      let at = i;
      for (let up = limbs[at]?.parent ?? -1; up >= 0 && !(this.#trunk[up] ?? false); up = limbs[at]?.parent ?? -1) at = up;
      return at;
    });
    limbs.forEach((l, i) => {
      const root = this.#roots[i] ?? i;
      const rs = limbs[root]?.start ?? l.start;
      this.#reach.set(root, Math.max(this.#reach.get(root) ?? 0.5, length(sub(l.end, rs))));
    });
  }
  /** The joint limb `i`'s bough leaves the trunk at, and its droop at `q`. The trunk stands on the copy's base. */
  at(i: number, q: Vec3): { bough: Vec3; droop: number } {
    if (this.#trunk[i] ?? true) return { bough: [0, 0, 0], droop: 0 };
    const root = this.#roots[i] ?? i;
    const bough = this.skel.limbs[root]?.start ?? [0, 0, 0];
    return { bough, droop: 0.2 * clamp(length(sub(q, bough)) / (this.#reach.get(root) ?? 1), 0, 1) };
  }
  /** The limb nearest `q`, by distance to its axis. */
  limbNear(q: Vec3): number {
    let best = 0;
    let bestD = Infinity;
    this.skel.limbs.forEach((l, i) => {
      const ab = sub(l.end, l.start);
      const t = clamp(dot(sub(q, l.start), ab) / Math.max(dot(ab, ab), 1e-9), 0, 1);
      const d = length(sub(q, addScaled(l.start, ab, t)));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }
}

// ---------- bark ----------

export function buildBark(p: Resolved<typeof barkParams>, ctx: BuildContext, skel: Skeleton): Built {
  const out = new PartBuilder("bark", "solid");
  const r = ctx.rand.fork("bark");
  const seed = Math.floor(r.next() * 1e6);
  const trunkRadius = skel.limbs[0]?.startRadius ?? 0.2;
  const boughs = new Boughs(skel);

  skel.limbs.forEach((limb, i) => {
    const lr = r.fork(`limb${i}`);
    const axis = sub(limb.end, limb.start);
    const len = length(axis);
    if (len < 1e-4) return;
    const dir = normalize(axis);
    // Sink each limb into its parent so joints never show a gap.
    const sink = limb.depth === 0 ? 0 : Math.min(limb.startRadius * 1.2, len * 0.3);
    const start = addScaled(limb.start, dir, -sink);
    const span = len + sink;
    const radial = limb.depth === 0 ? 10 : limb.startRadius > trunkRadius * 0.3 ? 7 : 5;
    const rings = clamp(Math.ceil(span / ((limb.startRadius + limb.endRadius) * 2.2)), 1, limb.depth === 0 ? 6 : 3);
    const [u, v] = basis(dir);
    // Limbs never go: twigs and leaves always have a limb under them, and a failing tree stands bare.
    const wither = 0.45 + 0.25 * lr.next();
    const furrows = limb.depth === 0 ? 7 : 4;

    const channels = (q: Vec3): Channels => {
      const b = boughs.at(i, q);
      return { loss: 0, droop: b.droop, wither, glow: 0, pivot: b.bough, bough: b.bough };
    };

    const ringStart = out.vertexCount;
    for (let k = 0; k <= rings; k++) {
      const t = k / rings;
      const along = t * span;
      const center = addScaled(start, dir, along);
      let radius = limb.startRadius + (limb.endRadius - limb.startRadius) * clamp((along - sink) / len, 0, 1);
      if (limb.depth === 0 && limb.parent === -1) {
        // Root flare where the trunk meets the ground.
        const f = Math.max(0, 1 - center[1] / (trunkRadius * 5));
        radius *= 1 + 0.55 * f * f;
      }
      for (let j = 0; j <= radial; j++) {
        const theta = (j / radial) * Math.PI * 2;
        const ring = add(scale(u, Math.cos(theta)), scale(v, Math.sin(theta)));
        const wobble = fbm3(center[0] * 1.7 + Math.cos(theta), center[1] * 0.8, center[2] * 1.7 + Math.sin(theta), seed, 2);
        const furrow = 0.5 + 0.5 * Math.sin(theta * furrows + wobble * 3 + center[1] * 0.6);
        const bump = 1 + p.roughness * (0.14 * (furrow - 0.5) + 0.05 * wobble);
        const q = addScaled(center, ring, radius * bump);
        const ground = clamp(center[1] / 1.2, 0, 1);
        const shade = (0.5 + 0.28 * (1 - p.roughness * 0.6) + 0.22 * furrow * (0.3 + p.roughness)) * (0.82 + 0.18 * ground) + 0.06 * wobble;
        out.vertex(q, ring, shade, channels(q));
      }
    }
    for (let k = 0; k < rings; k++) {
      for (let j = 0; j < radial; j++) {
        const a = ringStart + k * (radial + 1) + j;
        const b = a + radial + 1;
        out.triangle(a, b, a + 1);
        out.triangle(a + 1, b, b + 1);
      }
    }
    // Close the end with a short rounded tip.
    const last = ringStart + rings * (radial + 1);
    const tip = addScaled(limb.end, dir, limb.endRadius * 0.8);
    const tipIndex = out.vertex(tip, dir, 0.7, channels(tip));
    for (let j = 0; j < radial; j++) out.triangle(last + j, tipIndex, last + j + 1);
  });

  return { parts: [out.part()], anchors: skel.tips };
}

// ---------- leaf clumps ----------

export interface Clump {
  readonly center: V3;
  readonly radius: number;
  /** The limb that carries the clump's twigs. */
  readonly limb: number;
  readonly r: Rand;
}

/** Leaves the rest of the 40,000-triangle plant budget for bark and blossoms. */
const CLUMP_TRIANGLE_BUDGET = 24_000;

/** Each leaf's spray cut, and its sprays' size: a few broad maple leaves fill a larger spray than many small ovals. */
const SPRAY_CUTS = {
  pointed: { cut: CUT.cluster, card: 1 },
  oval: { cut: CUT.oval, card: 0.95 },
  lobed: { cut: CUT.lobed, card: 1.12 },
  blossom: { cut: CUT.umbels, card: 1 },
} as const;

/**
 * Clumps of leaves where a canopy's mass is: one at every tip and, for a
 * full crown, more along the inner limbs, so the crown reads as one mass
 * from afar. Each clump is a fan of twigs that leave its limb along the
 * limb's last stretch and curve out to the clump's surface, with sprays
 * along them, so every leaf is on a stalk on a twig on a limb and no ball
 * sits inside to show. Twigs and sprays take their bough's joint and droop,
 * and each twig bends about where it leaves the limb.
 */
export function buildLeafClumps(p: Resolved<typeof leafClumpsParams>, ctx: BuildContext, skel: Skeleton): Built {
  const r = ctx.rand.fork("clumps");
  const s = ctx.facts.scale ?? 1;
  const crown = crownOf(skel.tips.map((t) => t.position));
  const boughs = new Boughs(skel);
  const tipCount = Math.max(1, skel.tips.length);
  const shapeScale = p.shape === "plates" ? 1.2 : p.shape === "tufts" ? 0.62 : 1;
  // Clumps scale with how far apart the tips are, so neighbors just overlap at "medium".
  const spacing = meanNearest(skel.tips.map((t) => t.position));
  const base = Math.min(0.3 * s + 0.6 * spacing, 0.24 * crown.radius[0]) * p.size * shapeScale * (0.72 + 0.38 * p.fullness);

  const clumps: Clump[] = [];
  // Keep foliage off the ground and clear of the lower trunk, as v1 did.
  const fork = skel.limbs.reduce((m, l) => (l.depth === 0 ? Math.max(m, l.end[1]) : m), 0);
  const floor = Math.max(fork * 0.85, 1.2 * s);
  skel.tips.forEach((tip, i) => {
    const cr = r.fork(`tip${i}`);
    const radius = base * (0.75 + 0.3 * tip.size) * cr.range(0.85, 1.15);
    const lift = p.shape === "plates" ? 0.25 : 0.15;
    const center = add(addScaled(tip.position, tip.normal, radius * 0.35), [0, radius * lift, 0]);
    center[1] = Math.max(center[1], floor + radius * 0.5);
    clumps.push({ center, radius, limb: boughs.limbNear(tip.position), r: cr });
  });
  // Fill the crown's interior so a full canopy reads as one mass.
  const fill = Math.round(tipCount * Math.max(0, p.fullness - 0.35) * 0.9);
  const inner = skel.limbs.map((l, i) => ({ l, i })).filter(({ l }) => l.depth >= Math.max(1, maxDepthOf(skel) - 1));
  for (let i = 0; i < fill && inner.length > 0; i++) {
    const fr = r.fork(`fill${i}`);
    const pick = inner[Math.floor(fr.next() * inner.length)] as { l: Limb; i: number };
    const at = lerp(pick.l.start, pick.l.end, fr.range(0.3, 1));
    const { out: away } = crownPlace(crown, at);
    const radius = base * fr.range(0.8, 1.1);
    const center = addScaled(at, away, radius * 0.25);
    center[1] = Math.max(center[1], floor + radius * 0.5);
    clumps.push({ center, radius, limb: pick.i, r: fr });
  }

  const spray = SPRAY_CUTS[p.leaf];
  // Leaves keep near their own size on a great tree: its sprays grow only with the root of its scale.
  const look: ClumpLook = { twigs: 15, sprays: 6, half: 0.25 * spray.card * (s <= 1 ? s : Math.sqrt(s)), cut: spray.cut, shape: p.shape, ground: 0 };
  // A dense frame's crown thins its twigs, then drops interior fill clumps (added last), to stay in budget.
  let density = 1;
  const triangles = (): number => clumps.reduce((n, c) => n + twigsOf(look, c.radius, density) * TRIANGLES_PER_TWIG, 0);
  while (triangles() > CLUMP_TRIANGLE_BUDGET && density > 0.55) density -= 0.05;
  while (triangles() > CLUMP_TRIANGLE_BUDGET) clumps.pop();
  const leaf = new PartBuilder("leaf");
  const twigs = new PartBuilder("bark");
  const anchors: Anchor[] = [];
  for (const clump of clumps) emitClump(leaf, twigs, anchors, crown, boughs, clump, look, density);
  return { parts: [twigs.part(), leaf.part()], anchors };
}

/** How a crown's or a mound's clumps are built: twigs per square meter of clump, sprays per twig, a spray's half width, its cut, the clump's shape, and the lowest a spray may reach. */
export interface ClumpLook {
  readonly twigs: number;
  readonly sprays: number;
  readonly half: number;
  readonly cut: number;
  readonly shape: ClumpShape;
  readonly ground: number;
}

/** Each twig is a three-sided tube in two segments and a fork in one, with its sprays: 12 + 6 + 2 per spray. */
const TRIANGLES_PER_TWIG = 18 + 2 * 9;
const twigsOf = (look: ClumpLook, radius: number, density: number): number => Math.max(4, Math.round(look.twigs * radius * radius * density));

/**
 * One clump: twigs from its limb to points spread over its surface, a little
 * inside it, each with sprays along it and a fork with sprays of its own.
 * Anchors for flowers and berries sit on the twigs.
 */
export function emitClump(leaf: PartBuilder, bark: PartBuilder, anchors: Anchor[], crown: Crown, boughs: Boughs, clump: Clump, look: ClumpLook, density: number): void {
  const limb = boughs.skel.limbs[clump.limb] as Limb;
  const limbDir = normalize(sub(limb.end, limb.start));
  const nearEnd = length(sub(limb.end, clump.center)) < length(sub(limb.start, clump.center)) * 1.2;
  const loss = lossThreshold(clump.r.next(), 0.6);
  const wither = 0.75 + 0.25 * clump.r.next();
  const tint = clump.r.range(-0.08, 0.08);
  const seed = Math.floor(clump.r.next() * 1e6);
  const n = twigsOf(look, clump.radius, density);
  const r0 = Math.min(limb.endRadius * 0.85, 0.022 * Math.max(0.5, look.half / 0.25));
  for (let k = 0; k < n; k++) {
    const tr = clump.r.fork(`twig${k}`);
    // Aim at a point spread evenly over the clump's surface, a little inside it.
    const y = 1 - (2 * (k + tr.range(0.2, 0.8))) / n;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = k * 2.39996 + tr.range(-0.4, 0.4);
    const d = normalize([Math.cos(phi) * ring, y, Math.sin(phi) * ring]);
    const goal = shellPoint(clump.center, clump.radius * tr.range(0.62, 0.86), look.shape, d, seed).q;
    goal[1] = Math.max(goal[1], look.ground + look.half);
    // Twigs leave the limb all along its last stretch, at a shallow angle, and curve out to their goal.
    const root = lerp(limb.start, limb.end, nearEnd ? tr.range(0.45, 1) : tr.range(0.3, 0.9));
    const span = length(sub(goal, root));
    if (span < 0.05) continue;
    const dir = normalize(sub(goal, root));
    const ctrl = add(addScaled(root, normalize(add(limbDir, scale(dir, 0.8))), span * 0.45), [0, (0.05 - 0.1 * tr.next()) * span, 0]);
    const bez = (t: number): V3 => add(add(scale(root, (1 - t) * (1 - t)), scale(ctrl, 2 * t * (1 - t))), scale(goal, t * t));
    const carry = (q: Vec3): { bough: Vec3; droop: number } => boughs.at(clump.limb, q);
    const twigCh = (q: Vec3): Channels => {
      const b = carry(q);
      return { loss: 0, droop: b.droop, wither: 0.5, glow: 0, pivot: root, bough: b.bough, twig: root };
    };
    const line: V3[] = [0, 0.5, 1].map(bez);
    emitTwig(bark, line, r0 * tr.range(0.5, 0.8), r0 * 0.25, twigCh);
    const sprays = (on: readonly V3[], count: number, from: number): void => {
      for (let j = 0; j < count; j++) {
        const last = j === count - 1;
        const t = last ? 1 : from + (0.94 - from) * ((j + tr.range(0.2, 0.8)) / count);
        const { at: at0, dir: tdir } = pointOnPolyline(on, t);
        const out = crownPlace(crown, at0).out;
        const faceUp = normalize(add(UP, normalize(sub(at0, clump.center))));
        const sideDir = normalize(cross(tdir, faceUp));
        const sgn = j % 2 === 0 ? 1 : -1;
        const ang = last ? tr.range(-0.25, 0.25) : tr.range(0.55, 1.1);
        const sdir = normalize(add(add(scale(tdir, Math.cos(ang)), scale(sideDir, sgn * Math.sin(ang))), scale(out, 0.15)));
        // Near the soil a spray turns up rather than into it.
        if (at0[1] + sdir[1] * 2.3 * look.half - look.half < look.ground) sdir[1] = Math.abs(sdir[1]);
        if (at0[1] - 1.2 * look.half < look.ground) continue;
        const b = carry(at0);
        const depth = clamp(length(sub(at0, clump.center)) / clump.radius, 0, 1);
        const ch: Channels = {
          loss: clamp(loss + tr.range(-0.08, 0.08), 0.02, 0.9),
          droop: b.droop,
          wither: clamp(wither + tr.range(-0.1, 0.1), 0, 1),
          glow: 0,
          pivot: at0,
          bough: b.bough,
          twig: root,
          tint: clamp(tint * 0.4 + tr.range(-0.025, 0.025), -0.1, 0.1),
        };
        emitSpray(leaf, crown, at0, sdir, faceUp, look.half * tr.range(0.85, 1.15), look.cut, tr, ch, -0.16 * (1 - depth));
      }
    };
    sprays(line, look.sprays, 0.22);
    // A fork: a shorter side twig from partway along, with sprays of its own.
    const t = tr.range(0.4, 0.75);
    const from = bez(t);
    const side = normalize(add(sub(d, scale(dir, dot(d, dir))), [tr.range(-0.5, 0.5), tr.range(-0.2, 0.4), tr.range(-0.5, 0.5)]));
    const fgoal = addScaled(from, normalize(add(scale(dir, 0.5), side)), span * tr.range(0.3, 0.45));
    fgoal[1] = Math.max(fgoal[1], look.ground + look.half);
    const fork: V3[] = [from, fgoal];
    emitTwig(bark, fork, r0 * 0.35, r0 * 0.18, twigCh);
    sprays(fork, Math.max(2, Math.round(look.sprays * 0.5)), 0.3);
    // Flowers and berries hang from the twig just short of its end.
    const at = pointOnPolyline(line, 0.82).at;
    const b = carry(at);
    anchors.push({ position: at, normal: normalize(lerp(d, crownPlace(crown, at).out, 0.5)), size: clamp(clump.radius / Math.max(look.half * 3, 1e-3), 0, 1), carry: { bough: b.bough, twig: root, droop: b.droop } });
  }
}

/** A thin tapered twig: a three-sided tube along `pts`, bark-colored, never lost, so a bare tree keeps its twigs. */
function emitTwig(bark: PartBuilder, pts: readonly V3[], r0: number, r1: number, ch: (q: Vec3) => Channels): void {
  const radial = 3;
  const first = bark.vertexCount;
  for (let k = 0; k < pts.length; k++) {
    const t = k / (pts.length - 1);
    const dir = normalize(sub(pts[Math.min(pts.length - 1, k + 1)] as V3, pts[Math.max(0, k - 1)] as V3));
    const [u, v] = basis(dir);
    const radius = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const ring = add(scale(u, Math.cos(th)), scale(v, Math.sin(th)));
      const q = addScaled(pts[k] as V3, ring, radius);
      bark.vertex(q, ring, 0.62 + 0.1 * Math.cos(th), ch(q));
    }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a = first + k * (radial + 1) + j;
      const b = a + radial + 1;
      bark.triangle(a, b, a + 1);
      bark.triangle(a + 1, b, b + 1);
    }
  }
}

/**
 * A spray card rooted at `base` on its twig, reaching along `dir` and facing
 * about `face`. Its leaves shade with the crown's blended normal, so the
 * canopy lights as one volume; `shadeShift` darkens sprays deep in a clump.
 */
function emitSpray(leaf: PartBuilder, crown: Crown, base: V3, dir: V3, face: V3, half: number, form: number, r: Rand, ch: Channels, shadeShift: number): void {
  const roll = r.range(-0.5, 0.5);
  const flat = normalize(sub(face, scale(dir, dot(face, dir))));
  const across = normalize(rotate(cross(dir, flat), dir, roll));
  const normal = normalize(cross(across, dir));
  const n = dot(normal, face) < 0 ? scale(normal, -1) : normal;
  const reach = half * r.range(0.9, 1.15);
  // A needle spray runs from its base (0) to its tip (1); a spray of leaves from -1 to 1.
  const needles = form === CUT.needles;
  const rows = [-1, 1].map((b) =>
    [-1, 1].map((a): CardPoint => {
      const q = add(addScaled(base, dir, (b + 1) * reach), scale(across, a * half));
      return { p: q, across: a, along: needles ? (b + 1) / 2 : b, n: blendNormal(n, crownPlace(crown, q).out, 0.6), shade: canopyShade(crown, q, n[1], ch.tint ?? 0) + shadeShift };
    }),
  );
  emitCard(leaf, rows, cutOf(form, r.next()), ch);
}

export type ClumpShape = "round" | "plates" | "tufts";

/** A point on a clump's lumpy shell, along unit direction `n`. */
function shellPoint(center: V3, radius: number, shape: ClumpShape, n: Vec3, seed: number): { q: V3; lump: number } {
  const lumpiness = shape === "tufts" ? 0.32 : 0.26;
  const lump = 1 + lumpiness * fbm3(n[0] * 1.6 + seed * 0.013, n[1] * 1.6, n[2] * 1.6, seed, 3) + 0.08 * Math.max(0, n[1]);
  let sx = 1, sy = 0.86, sz = 1;
  if (shape === "plates") {
    sx = 1.4;
    sz = 1.4;
    sy = n[1] > 0 ? 0.32 : 0.55;
  }
  return { q: [center[0] + n[0] * radius * sx * lump, center[1] + n[1] * radius * sy * lump, center[2] + n[2] * radius * sz * lump], lump: (lump - 1) / lumpiness };
}

/** Brightness across a canopy: brighter toward its rim and its top, each clump a little different. */
const canopyShade = (crown: Crown, q: Vec3, ny: number, tint: number): number =>
  0.3 + 0.45 * clamp((crownPlace(crown, q).depth - 0.35) / 0.75, 0, 1) + 0.14 * ny + 0.5 * tint;

// ---------- leaf strands ----------

export function buildLeafStrands(p: Resolved<typeof leafStrandsParams>, ctx: BuildContext, skel: Skeleton): Built {
  const out = new PartBuilder("leaf");
  const r = ctx.rand.fork("strands");
  const s = ctx.facts.scale ?? 1;
  const crown = crownOf(skel.tips.map((t) => t.position));
  const boughs = new Boughs(skel);

  // Strands hang from the tips and from the undersides of the outer limbs.
  const hangs: { at: V3; out: V3; limb: number }[] = skel.tips.map((t) => ({ at: [...t.position] as V3, out: [...t.normal] as V3, limb: boughs.limbNear(t.position) }));
  const spacing = (0.3 * s) / (0.5 + p.fullness);
  skel.limbs.forEach((limb, i) => {
    if (limb.depth < 1) return;
    const span = length(sub(limb.end, limb.start));
    const steps = Math.floor(span / spacing);
    const d = normalize(sub(limb.end, limb.start));
    for (let k = 1; k <= steps; k++) {
      const t = k / (steps + 1);
      const under = 0.8 * (limb.startRadius + (limb.endRadius - limb.startRadius) * t);
      hangs.push({ at: add(lerp(limb.start, limb.end, t), [0, -under, 0]), out: d, limb: i });
    }
  });

  const leafLen = 0.3 * s;
  const leafWide = 0.085 * s;
  const anchors: Anchor[] = [];
  hangs.forEach((h, i) => {
    const sr = r.fork(`strand${i}`);
    if (sr.next() > 0.45 + 0.55 * p.fullness) return;
    const fall = Math.min(p.length * 2.2 * s * sr.range(0.7, 1.15), Math.max(0.3, h.at[1] - 0.2 * s));
    const outward = normalize([h.out[0] + sr.range(-0.3, 0.3), 0, h.out[2] + sr.range(-0.3, 0.3)]);
    const drift = fall * 0.12 * sr.range(0.5, 1);
    const loss = lossThreshold(sr.next(), 0.55);
    const wither = 0.75 + 0.25 * sr.next();
    const sway = sr.next() * Math.PI * 2;
    const curve = (t: number): V3 => [
      h.at[0] + outward[0] * drift * Math.sin(t * Math.PI * 0.5) + Math.sin(t * 5 + sway) * 0.04 * s,
      h.at[1] - fall * Math.pow(t, 1.08),
      h.at[2] + outward[2] * drift * Math.sin(t * Math.PI * 0.5) + Math.cos(t * 5 + sway) * 0.04 * s,
    ];
    // The strand hangs from its limb: it sags with its bough and swings about where it hangs.
    const b = boughs.at(h.limb, h.at);
    const hung = { droop: b.droop, glow: 0, pivot: h.at, bough: b.bough, twig: h.at };
    // Two sprays of leaves at the hang point hide the limb above the curtain.
    for (let k = 0; k < 2; k++) {
      const d = normalize([sr.range(-1, 1), sr.range(0.1, 0.9), sr.range(-1, 1)]);
      emitSpray(out, crown, h.at, d, normalize(add(UP, d)), leafLen * 0.8, CUT.cluster, sr, { ...hung, loss: Math.max(0.01, loss + 0.02), wither }, 0.05);
    }
    // The strand: two crossed ribbons of small leaves, so from any side it hangs
    // as a leafy thread. The ribbons narrow toward the bottom, and the lowest
    // leaves fall first as vitality drops, so a failing strand shortens.
    const strandTint = sr.fork("tint").range(-0.08, 0.08) * 0.4;
    const segments = Math.max(3, Math.ceil(fall / (0.3 * s)));
    const half = leafWide * 1.3;
    const cut = cutOf(CUT.strand, sr.next());
    for (let ribbon = 0; ribbon < 2; ribbon++) {
      const rows: CardPoint[][] = [];
      for (let k = 0; k <= segments; k++) {
        const t = k / segments;
        const at = curve(t);
        const along = normalize(sub(curve(Math.min(1, t + 0.05)), curve(Math.max(0, t - 0.05))));
        const [u] = basis(along);
        const side = normalize(rotate(u, along, sway + ribbon * Math.PI * 0.5));
        const w = half * (1 - 0.3 * t);
        const place = crownPlace(crown, at);
        const normal = blendNormal(outward, place.out, 0.7);
        const shade = 0.36 + 0.36 * clamp(place.depth - 0.3, 0, 1) + 0.18 * (1 - t);
        rows.push([-1, 1].map((a) => ({ p: addScaled(at, side, a * w), across: a, along: (t * fall) / half, n: normal, shade })));
      }
      // Loss and wither vary down the strand, so build it row by row.
      const first = out.vertexCount;
      rows.forEach((row, k) => {
        const t = k / segments;
        const ch: Channels = { ...hung, loss: Math.max(0.01, loss + 0.14 * t), wither: clamp(wither + 0.15 * t, 0, 1), tint: strandTint };
        for (const v of row) out.vertex(v.p, v.n, v.shade, ch, [v.across, v.along, cut]);
      });
      for (let k = 0; k < segments; k++) {
        const a = first + k * 2;
        out.triangle(a, a + 2, a + 1);
        out.triangle(a + 1, a + 2, a + 3);
      }
    }
    // Pods hang from the limb itself among the strands.
    if (sr.next() < 0.5) {
      const limb = skel.limbs[h.limb] as Limb;
      const ab = sub(limb.end, limb.start);
      const on = addScaled(limb.start, ab, clamp(dot(sub(h.at, limb.start), ab) / Math.max(dot(ab, ab), 1e-9), 0, 1));
      anchors.push({ position: on, normal: outward, size: sr.range(0.6, 1), carry: { bough: b.bough, twig: h.at, droop: boughs.at(h.limb, on).droop } });
    }
  });
  return { parts: [out.part()], anchors };
}

// ---------- needles ----------

/** Chains of limb segments that continue one another at the same depth. */
function chainsOf(skel: Skeleton): Limb[][] {
  const chains: Limb[][] = [];
  const next = new Map<number, number>();
  skel.limbs.forEach((l, i) => {
    const parent = skel.limbs[l.parent];
    if (parent !== undefined && parent.depth === l.depth && !next.has(l.parent)) next.set(l.parent, i);
  });
  skel.limbs.forEach((l, i) => {
    const parent = skel.limbs[l.parent];
    if (parent !== undefined && parent.depth === l.depth && next.get(l.parent) === i) return;
    const chain: Limb[] = [l];
    for (let at = next.get(i); at !== undefined; at = next.get(at)) chain.push(skel.limbs[at] as Limb);
    chains.push(chain);
  });
  return chains;
}

export function buildNeedles(p: Resolved<typeof needlesParams>, ctx: BuildContext, skel: Skeleton): Built {
  const out = new PartBuilder("leaf");
  const r = ctx.rand.fork("needles");
  const s = ctx.facts.scale ?? 1;
  const crown = crownOf(skel.limbs.filter((l) => l.depth >= 1).map((l) => l.end));
  const chains = chainsOf(skel);
  const boughs = new Boughs(skel);
  const top = skel.limbs.reduce((m, l) => Math.max(m, l.end[1]), 0.01);
  const anchors: Anchor[] = [];

  chains.forEach((chain, i) => {
    const first = chain[0] as Limb;
    const last = chain[chain.length - 1] as Limb;
    const depth = first.depth;
    const cr = r.fork(`spray${i}`);
    if (depth === 0) {
      // A tuft along the top of the leader.
      const tipY = last.end[1];
      emitFrond(out, crown, [lerp(last.start, last.end, 0.1), lerp(last.start, last.end, 0.55), last.end], p.length * 0.32 * s, cr, p, tipY / top, (q) => boughs.at(skel.limbs.indexOf(last), q));
      return;
    }
    if (depth >= 2 && p.fullness < 0.7) return;
    const points: Vec3[] = [first.start, ...chain.map((l) => l.end)];
    const tip = points[points.length - 1] as Vec3;
    const width = p.length * (depth === 1 ? 0.5 : 0.36) * s * (0.85 + 0.25 * p.fullness);
    const carry = (q: Vec3): { bough: Vec3; droop: number } => boughs.at(skel.limbs.indexOf(first), q);
    emitFrond(out, crown, points, width, cr, p, tip[1] / top, carry);
    const at = carry(tip);
    anchors.push({ position: tip, normal: normalize(sub(tip, points[points.length - 2] as Vec3)), size: depth === 1 ? 1 : 0.5, carry: { bough: at.bough, twig: at.bough, droop: at.droop } });
  });
  return { parts: [out.part()], anchors };
}

function pointOnPolyline(points: readonly Vec3[], t: number): { at: V3; dir: V3 } {
  const segs = points.length - 1;
  const f = clamp(t, 0, 1) * segs;
  const k = Math.min(segs - 1, Math.floor(f));
  const a = points[k] as Vec3;
  const b = points[k + 1] as Vec3;
  return { at: lerp(a, b, f - k), dir: normalize(sub(b, a)) };
}

/** A horizontal direction across a limb, even where the limb runs straight up. */
function acrossOf(dir: Vec3): V3 {
  const side = cross(dir, UP);
  return length(side) > 0.2 ? normalize(side) : basis(dir)[0];
}

/**
 * A spray of needles along a limb's polyline, built like a fir's frond: a
 * slim dark core for its mass, a narrow ridge of needles along its top, and
 * branchlets to either side that reach toward the tip and droop, each a
 * small creased needle card. The branchlets alternate and vary, so a spray
 * reads as layered, feathery needles from the side and from below rather
 * than as one flat plate.
 */
function emitFrond(
  out: PartBuilder,
  crown: Crown,
  points: readonly Vec3[],
  width: number,
  r: Rand,
  p: Resolved<typeof needlesParams>,
  heightFrac: number,
  carry: (q: Vec3) => { bough: Vec3; droop: number },
): void {
  const sphere = icosphere(1);
  const first = out.vertexCount;
  const seed = Math.floor(r.next() * 1e6);
  // Lower sprays shed first, as an ailing conifer browns from the bottom up.
  const loss = clamp(lossThreshold(r.next(), 0.5) + 0.12 * (1 - heightFrac), 0.02, 0.7);
  const wither = 0.7 + 0.3 * r.next();
  const tint = r.range(-0.06, 0.06);
  const lift = 0.12 * (p.fullness < 0.9 ? 1 : 0.5) * heightFrac;
  const core = width * 0.36;
  for (const n of sphere.points) {
    // x runs along the limb from just past its base to its tip.
    const t = 0.08 + (n[0] * 0.5 + 0.5) * 0.85;
    const { at, dir } = pointOnPolyline(points, t);
    const side = acrossOf(dir);
    const up = normalize(cross(side, dir));
    const profile = Math.sin(Math.PI * clamp(t * 0.92 + 0.04, 0, 1)) * 0.75 + 0.25;
    const w = core * profile * (1 + 0.18 * fbm3(n[0] * 2.5 + seed * 0.01, n[1] * 2.5, n[2] * 2.5, seed, 2));
    const q = add(at, add(scale(side, n[2] * w), scale(up, (n[1] * 0.45 - 0.3) * w)));
    const place = crownPlace(crown, q);
    const normal = blendNormal([side[0] * n[2] + up[0] * n[1], side[1] * n[2] + up[1] * n[1], side[2] * n[2] + up[2] * n[1]], place.out, 0.5);
    const shade = 0.14 + 0.36 * clamp(place.depth - 0.25, 0, 1) + 0.16 * Math.max(0, n[1]) + 0.5 * tint + lift;
    out.vertex(q, normal, shade, {
      loss: Math.max(0.01, loss + 0.08 * t),
      droop: carry(at).droop,
      wither,
      glow: 0,
      pivot: at,
      bough: carry(at).bough,
      tint: tint * 0.4,
    }, CORE);
  }
  for (const [a, b, c] of sphere.triangles) out.triangle(first + a, first + b, first + c);

  // Each card sags with its bough by the bark's rule where it leaves the limb; a branchlet also bends about that point.
  const channelsAt = (t: number, edge: number, cardTint: number, from = t, twig = false): Channels => {
    const at = pointOnPolyline(points, from).at;
    const b = carry(at);
    return {
      loss: Math.max(0.01, loss + 0.08 * t + 0.03 * edge),
      droop: b.droop,
      wither: clamp(wither + 0.1 * edge, 0, 1),
      glow: 0,
      pivot: pointOnPolyline(points, t).at,
      bough: b.bough,
      ...(twig ? { twig: at } : {}),
      tint: cardTint,
    };
  };

  // The ridge: a narrow needle card along the top of the limb.
  const ridgeRows = 5;
  const ridgeCut = cutOf(CUT.needles, r.next());
  const ridgeTint = clamp(tint * 0.4 + r.range(-0.02, 0.02), -0.1, 0.1);
  const ridgeFirst = out.vertexCount;
  for (let k = 0; k <= ridgeRows; k++) {
    const v = k / ridgeRows;
    const t = 0.04 + 0.94 * v;
    const { at, dir } = pointOnPolyline(points, t);
    const side = acrossOf(dir);
    const up = normalize(cross(side, dir));
    const w = width * 0.62 * (1 - 0.5 * v);
    for (const a of [-1, 0, 1]) {
      const q = add(at, add(scale(side, a * w * 0.85), scale(up, width * 0.12 - Math.abs(a) * w * 0.5)));
      const place = crownPlace(crown, q);
      const normal = blendNormal(normalize(add(up, scale(side, a * 0.6))), place.out, 0.5);
      const shade = 0.34 + 0.42 * clamp(place.depth - 0.25, 0, 1) + 0.1 * (1 - Math.abs(a)) + 0.5 * tint + lift;
      out.vertex(q, normal, shade, channelsAt(t, Math.abs(a), ridgeTint), [a, v, ridgeCut]);
    }
  }
  for (let k = 0; k < ridgeRows; k++) {
    for (let j = 0; j < 2; j++) {
      const a = ridgeFirst + k * 3 + j;
      out.triangle(a, a + 3, a + 1);
      out.triangle(a + 1, a + 3, a + 4);
    }
  }

  // Branchlets, alternating sides, shorter and more drooping toward the tip.
  const span = points.slice(1).reduce((n, q, i) => n + length(sub(q, points[i] as Vec3)), 0);
  const count = Math.round(clamp(span / (width * 0.3), 5, 11));
  for (let k = 0; k < count; k++) {
    for (const sideSign of [-1, 1]) {
      const t = 0.1 + 0.84 * ((k + (sideSign > 0 ? 0.25 : 0.75)) / count) + r.range(-0.03, 0.03);
      const { at, dir } = pointOnPolyline(points, t);
      const side = acrossOf(dir);
      const up = normalize(cross(side, dir));
      const reach = width * (0.8 - 0.4 * t) * r.range(0.8, 1.15);
      const forward = r.range(0.6, 0.95);
      const drop = r.range(0.1, 0.3) + 0.25 * t + 0.2 * (1 - heightFrac);
      const flat = normalize(add(scale(side, sideSign * Math.cos(forward)), scale(dir, Math.sin(forward))));
      const along = normalize(add(scale(flat, Math.cos(drop)), scale(up, -Math.sin(drop))));
      // The card's width lies nearly level, rolled a little, creased along its middle.
      const roll = r.range(-0.35, 0.35);
      const wide = normalize(rotate(normalize(cross(up, along)), along, roll));
      const crest = normalize(cross(along, wide));
      const halfWide = reach * r.range(0.36, 0.44);
      const cut = cutOf(CUT.needles, r.next());
      const cardTint = clamp(tint * 0.4 + r.range(-0.03, 0.03), -0.1, 0.1);
      const firstCard = out.vertexCount;
      for (const v of [0, 1]) {
        const base = addScaled(at, along, v * reach);
        for (const a of [-1, 0, 1]) {
          const q = add(base, add(scale(wide, a * halfWide * (1 - 0.35 * v)), scale(crest, (0.18 - 0.3 * Math.abs(a)) * halfWide)));
          const place = crownPlace(crown, q);
          const normal = blendNormal(normalize(add(crest, scale(wide, a * 0.5))), place.out, 0.5);
          const shade = 0.28 + 0.42 * clamp(place.depth - 0.25, 0, 1) + 0.12 * Math.max(0, crest[1]) + 0.08 * v + 0.5 * tint + lift;
          out.vertex(q, normal, shade, channelsAt(Math.min(1, t + 0.1 * v), Math.abs(a) * 0.5 + v * 0.5, cardTint, t, true), [a, v, cut]);
        }
      }
      for (let j = 0; j < 2; j++) {
        const a = firstCard + j;
        out.triangle(a, a + 3, a + 1);
        out.triangle(a + 1, a + 3, a + 4);
      }
    }
  }
}

// ---------- blossoms ----------

const BLOSSOM_CAP = { petals: 170, pods: 70, berries: 80 } as const;

/**
 * Flowers, pods or berries on the anchors the foliage leaves on its twigs
 * and limbs. Each hangs from its anchor on a stalk, sags with the bough that
 * carries it and bends with its twig, and drops in place as vitality falls.
 */
export function buildBlossoms(p: Resolved<typeof blossomsParams>, ctx: BuildContext, anchors: readonly Anchor[]): Built {
  const out = new PartBuilder("bloom");
  const r = ctx.rand.fork("blossoms");
  const s = ctx.facts.scale ?? 1;
  const picker = r.fork("pick");
  const want = Math.min(BLOSSOM_CAP[p.form], Math.round(anchors.length * p.count));
  const chosen = anchors
    .map((a, i) => ({ a, i, key: picker.next() }))
    .sort((x, y) => x.key - y.key)
    .slice(0, want)
    .sort((x, y) => x.i - y.i);
  for (const { a, i } of chosen) {
    const ar = r.fork(`at${i}`);
    const loss = 0.3 + 0.45 * ar.next();
    const size = s * (0.75 + 0.35 * a.size);
    const carry = { pivot: a.position, bough: a.carry?.bough ?? a.position, twig: a.carry?.twig ?? a.carry?.bough ?? a.position, droop: a.carry?.droop ?? 0 };
    if (p.form === "petals") {
      // A truss of small five-petaled flowers on fine stalks, rooted on the twig and reaching out and a little up.
      const dir = normalize(add(a.normal, [ar.range(-0.3, 0.3), 0.5, ar.range(-0.3, 0.3)]));
      const [side] = basis(dir);
      const half = 0.16 * size;
      const rows = [-1, 1].map((b) =>
        [-1, 1].map((x): CardPoint => ({ p: add(addScaled(a.position, dir, (b + 1) * half), scale(side, x * half)), across: x, along: b, n: normalize(add(a.normal, [0, 0.4, 0])), shade: 0.7 })),
      );
      emitCard(out, rows, cutOf(CUT.umbels, ar.next()), { ...carry, loss, wither: 1, glow: 0 });
    } else if (p.form === "pods") {
      const hang = 0.12 * size;
      const center = add(a.position, [0, -hang - 0.12 * size, 0]);
      emitBall(out, center, [0.065 * size, 0.09 * size, 0.065 * size], 1, { ...carry, loss, wither: 1, glow: 1 }, 0.55);
      emitStalk(out, a.position, add(center, [0, 0.08 * size, 0]), 0.012 * size, { ...carry, loss, wither: 1, glow: 0 });
    } else {
      // A cluster of berries hanging on a short stalk from the twig.
      const berries = 4 + Math.floor(ar.next() * 4);
      const hang = add(a.position, [0, -0.07 * size, 0]);
      const ch = { ...carry, loss, wither: 1, glow: 0 };
      emitStalk(out, a.position, hang, 0.008 * size, ch);
      for (let b = 0; b < berries; b++) {
        const rad = 0.028 * size * ar.range(0.8, 1.2);
        const c = add(hang, [ar.range(-0.04, 0.04) * size, -rad * ar.range(0.4, 1), ar.range(-0.04, 0.04) * size]);
        emitBall(out, c, [rad, rad, rad], 0, ch, 0.45);
      }
    }
  }
  return { parts: [out.part()], anchors: [] };
}

function emitBall(out: PartBuilder, center: V3, radii: V3, subdiv: number, ch: Channels, shadeBase: number): void {
  const sphere = icosphere(subdiv);
  const first = out.vertexCount;
  for (const n of sphere.points) {
    const q: V3 = [center[0] + n[0] * radii[0], center[1] + n[1] * radii[1], center[2] + n[2] * radii[2]];
    out.vertex(q, n, shadeBase + 0.4 * (n[1] * 0.5 + 0.5), ch);
  }
  for (const [a, b, c] of sphere.triangles) out.triangle(first + a, first + b, first + c);
}

function emitStalk(out: PartBuilder, from: Vec3, to: Vec3, radius: number, ch: Channels): void {
  const dir = normalize(sub(to, from));
  const [u, v] = basis(dir);
  const first = out.vertexCount;
  for (const end of [from, to]) {
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2;
      const ring = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
      out.vertex(addScaled(end, ring, radius), ring, 0.3, { ...ch, glow: 0 });
    }
  }
  for (let j = 0; j < 3; j++) {
    const a = first + j;
    const b = first + ((j + 1) % 3);
    out.triangle(a, a + 3, b);
    out.triangle(b, a + 3, b + 3);
  }
}
