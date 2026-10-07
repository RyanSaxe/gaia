// Surfaces, foliage and ornaments. Every vertex carries its vitality
// response: foliage pieces vanish at spread-out thresholds, sag and wither;
// the trunk never vanishes; only pods glow.

import { type Anchor, type BuildContext, type Built, CUT, type Limb, type Rand, type Resolved, type Skeleton, type Vec3 } from "@gaia/schema";
import type { barkParams, blossomsParams, leafClumpsParams, leafStrandsParams, needlesParams } from "../flora.ts";
import {
  type Channels,
  PartBuilder,
  type V3,
  add,
  addScaled,
  basis,
  clamp,
  cross,
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

/** The foliage volume's center and half-extents, from the frame's tips. */
interface Crown {
  readonly center: V3;
  readonly radius: V3;
}

function crownOf(points: readonly Vec3[]): Crown {
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

/** A leaf card's cut, with the card's own seed (0 to 1) in its fraction. */
const cutOf = (form: number, seed: number): number => form + 0.999 * clamp(seed, 0, 1);

/** One vertex of a leaf card: where it is, its place on the card, its normal and shade. */
interface CardPoint {
  readonly p: V3;
  readonly across: number;
  readonly along: number;
  readonly n: V3;
  readonly shade: number;
}

/** A leaf card as a grid of rows (along the card) of points (across it). */
function emitCard(out: PartBuilder, rows: readonly (readonly CardPoint[])[], cut: number, ch: Channels): void {
  const first = out.vertexCount;
  const cols = rows[0]?.length ?? 0;
  for (const row of rows) for (const v of row) out.vertex(v.p, v.n, v.shade, ch, [v.across, v.along, cut]);
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const a = first + i * cols + j;
      const b = a + cols;
      out.triangle(a, b, a + 1);
      out.triangle(a + 1, b, b + 1);
    }
  }
}

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

/** The first limb of each depth-1 bough, by limb index: the point a whole bough sags around. */
function boughRoots(s: Skeleton): number[] {
  return s.limbs.map((l, i) => {
    let at = i;
    let limb: Limb = l;
    while (limb.depth > 1 || (limb.depth === 1 && (s.limbs[limb.parent]?.depth ?? 0) === 1)) {
      const up = s.limbs[limb.parent];
      if (up === undefined) break;
      at = limb.parent;
      limb = up;
    }
    return at;
  });
}

// ---------- bark ----------

export function buildBark(p: Resolved<typeof barkParams>, ctx: BuildContext, skel: Skeleton): Built {
  const out = new PartBuilder("bark", "solid");
  const r = ctx.rand.fork("bark");
  const seed = Math.floor(r.next() * 1e6);
  const maxDepth = maxDepthOf(skel);
  const trunkRadius = skel.limbs[0]?.startRadius ?? 0.2;
  const roots = boughRoots(skel);
  const reach = new Map<number, number>();
  skel.limbs.forEach((l, i) => {
    const root = roots[i] ?? i;
    const rs = skel.limbs[root]?.start ?? l.start;
    reach.set(root, Math.max(reach.get(root) ?? 0.5, length(sub(l.end, rs))));
  });

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
    const root = roots[i] ?? i;
    const pivot = limb.depth === 0 ? limb.start : (skel.limbs[root]?.start ?? limb.start);
    const boughReach = reach.get(root) ?? 1;
    const fine = limb.depth >= 2 && limb.depth === maxDepth && limb.startRadius < trunkRadius * 0.25;
    const loss = fine ? lossThreshold(lr.next(), 0.16, 0.03) : 0;
    const wither = 0.45 + 0.25 * lr.next();
    const furrows = limb.depth === 0 ? 7 : 4;

    const channels = (q: Vec3): Channels => ({
      loss,
      droop: limb.depth === 0 ? 0 : 0.2 * clamp(length(sub(q, pivot)) / boughReach, 0, 1),
      wither,
      glow: 0,
      pivot,
    });

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

interface Clump {
  readonly center: V3;
  readonly pivot: Vec3;
  readonly radius: number;
  readonly lift: number;
  readonly r: Rand;
}

/** Leaves the rest of the 40,000-triangle plant budget for bark and blossoms. */
const CLUMP_TRIANGLE_BUDGET = 30_000;

export function buildLeafClumps(p: Resolved<typeof leafClumpsParams>, ctx: BuildContext, skel: Skeleton): Built {
  const out = new PartBuilder("leaf");
  const r = ctx.rand.fork("clumps");
  const s = ctx.facts.scale ?? 1;
  const crown = crownOf(skel.tips.map((t) => t.position));
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
    clumps.push({ center, pivot: tip.position, radius, lift, r: cr });
  });
  // Fill the crown's interior so a full canopy reads as one mass.
  const fill = Math.round(tipCount * Math.max(0, p.fullness - 0.35) * 0.9);
  const inner = skel.limbs.filter((l) => l.depth >= Math.max(1, maxDepthOf(skel) - 1));
  for (let i = 0; i < fill && inner.length > 0; i++) {
    const fr = r.fork(`fill${i}`);
    const limb = inner[Math.floor(fr.next() * inner.length)] as Limb;
    const at = lerp(limb.start, limb.end, fr.range(0.3, 1));
    const { out: away } = crownPlace(crown, at);
    const radius = base * fr.range(0.8, 1.1);
    const center = addScaled(at, away, radius * 0.25);
    center[1] = Math.max(center[1], floor + radius * 0.5);
    clumps.push({ center, pivot: at, radius, lift: 0, r: fr });
  }

  const anchors: Anchor[] = [];
  // Each clump is a once-subdivided core (80 triangles), the soft mass seen from
  // afar, under a shell of leaf cards (2 triangles each) that gives it leafy
  // edges up close. Very full crowns on dense frames first thin their cards,
  // then lose interior fill clumps (added last), so a tree stays inside its budget.
  const blobs = p.shape === "tufts" ? 3 : 1;
  const cardsFor = (radius: number): number => Math.round(clamp(6.3 * (radius / cardHalf(radius, s)) ** 2, 10, 90));
  const blobRadius = (clump: Clump): number => (blobs === 1 ? clump.radius : clump.radius * 0.68);
  let density = 1;
  const triangles = (): number => clumps.reduce((n, c) => n + blobs * (80 + 2 * Math.round(cardsFor(blobRadius(c)) * density)), 0);
  while (triangles() > CLUMP_TRIANGLE_BUDGET && density > 0.55) density -= 0.05;
  while (triangles() > CLUMP_TRIANGLE_BUDGET) clumps.pop();
  for (const clump of clumps) {
    const loss = lossThreshold(clump.r.next(), 0.6);
    const droop = 0.22 + 0.18 * clump.r.next();
    const wither = 0.75 + 0.25 * clump.r.next();
    const tint = clump.r.range(-0.08, 0.08);
    const seed = Math.floor(clump.r.next() * 1e6);
    for (let b = 0; b < blobs; b++) {
      const center =
        blobs === 1
          ? clump.center
          : add(clump.center, [clump.r.range(-0.6, 0.6) * clump.radius, clump.r.range(-0.3, 0.5) * clump.radius, clump.r.range(-0.6, 0.6) * clump.radius]);
      const rad = blobs === 1 ? clump.radius : clump.radius * clump.r.range(0.55, 0.8);
      const look = { loss, droop, wither, tint, pivot: clump.pivot };
      // The core thins first, so a declining canopy turns airy before it goes bare.
      emitBlob(out, crown, center, rad * 0.8, p.shape, 1, seed + b * 31, { ...look, loss: Math.min(0.95, loss + 0.1) }, -0.06);
      emitLeafCards(out, crown, center, rad, p.shape, seed + b * 31, Math.round(cardsFor(rad) * density), clump.r.fork(`cards${b}`), look, s);
    }
    // Anchors on the sunlit outer face of each clump, where blossoms show.
    for (let k = 0; k < 5; k++) {
      const d = normalize([clump.r.range(-1, 1), clump.r.range(-0.2, 1), clump.r.range(-1, 1)]);
      const { out: away } = crownPlace(crown, clump.center);
      const facing = normalize(lerp(d, away, 0.5));
      anchors.push({ position: addScaled(clump.center, facing, clump.radius * 0.92), normal: facing, size: clamp(clump.radius / (base * 1.2), 0, 1) });
    }
  }
  return { parts: [out.part()], anchors };
}

/** Half the width of a leaf card: a cluster of a few leaves, a little larger on larger clumps. */
const cardHalf = (radius: number, s: number): number => Math.min(0.2 * s + 0.1 * radius, 0.6 * radius);

interface BlobLook {
  readonly loss: number;
  readonly droop: number;
  readonly wither: number;
  readonly tint: number;
  readonly pivot: Vec3;
}

type ClumpShape = "round" | "plates" | "tufts";

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

function emitBlob(
  out: PartBuilder,
  crown: Crown,
  center: V3,
  radius: number,
  shape: ClumpShape,
  subdiv: number,
  seed: number,
  look: BlobLook,
  shadeShift = 0,
): void {
  const sphere = icosphere(subdiv);
  const first = out.vertexCount;
  for (const n of sphere.points) {
    const { q, lump } = shellPoint(center, radius, shape, n, seed);
    const normal = blendNormal(n, crownPlace(crown, q).out, 0.6);
    // Each clump varies a little in brightness and a little in hue, as v1's canopies did.
    const shade = canopyShade(crown, q, n[1], look.tint) + 0.08 * lump + shadeShift;
    out.vertex(q, normal, shade, {
      loss: Math.max(0.01, look.loss + 0.07 * fbm3(n[0] * 3 + 5, n[1] * 3, n[2] * 3, seed + 7, 2)),
      droop: look.droop,
      wither: look.wither,
      glow: 0,
      pivot: look.pivot,
      tint: look.tint * 0.4,
    });
  }
  for (const [a, b, c] of sphere.triangles) out.triangle(first + a, first + b, first + c);
}

/**
 * A shell of leaf cards over a clump. Each card leans out of the mass like a
 * spray of leaves, turned at random about the clump's outward direction, so
 * the clump's edge is leafy from every side. Cards shade with the clump's
 * outward normal blended toward the crown, so the canopy still lights as one
 * volume; each card drops and withers on its own, so decline thins it.
 */
function emitLeafCards(
  out: PartBuilder,
  crown: Crown,
  center: V3,
  radius: number,
  shape: ClumpShape,
  seed: number,
  count: number,
  r: Rand,
  look: BlobLook,
  s: number,
): void {
  for (let k = 0; k < count; k++) {
    // Spread evenly over the shell (a Fibonacci sphere), jittered.
    const y = 1 - (2 * (k + r.range(0.2, 0.8))) / count;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = k * 2.39996 + r.range(-0.4, 0.4);
    const dir = normalize([Math.cos(phi) * ring, y, Math.sin(phi) * ring]);
    const { q: onShell } = shellPoint(center, radius * r.range(0.86, 1.0), shape, dir, seed);
    const outward = normalize(sub(onShell, center));
    const [u, v] = basis(outward);
    const turn = r.next() * Math.PI * 2;
    const tangent = add(scale(u, Math.cos(turn)), scale(v, Math.sin(turn)));
    const lean = r.range(0.6, 1.3);
    const along = normalize(add(scale(outward, Math.cos(lean)), scale(tangent, Math.sin(lean))));
    const across = normalize(cross(along, outward));
    const half = cardHalf(radius, s) * r.range(0.85, 1.15);
    const tint = clamp(look.tint * 0.4 + r.range(-0.025, 0.025), -0.1, 0.1);
    const lift = r.range(-0.05, 0.08);
    const ch: Channels = {
      loss: clamp(look.loss + r.range(-0.1, 0.1), 0.01, 0.95),
      droop: look.droop,
      wither: clamp(look.wither + r.range(-0.15, 0.1), 0, 1),
      glow: 0,
      pivot: look.pivot,
      tint,
    };
    const rows = [-1, 1].map((b) =>
      [-1, 1].map((a): CardPoint => {
        const p = add(add(onShell, scale(across, a * half)), scale(along, b * half));
        const fromCenter = normalize(sub(p, center));
        return { p, across: a, along: b, n: blendNormal(fromCenter, crownPlace(crown, p).out, 0.6), shade: canopyShade(crown, p, fromCenter[1], look.tint) + lift };
      }),
    );
    emitCard(out, rows, cutOf(CUT.cluster, r.next()), ch);
  }
}

// ---------- leaf strands ----------

export function buildLeafStrands(p: Resolved<typeof leafStrandsParams>, ctx: BuildContext, skel: Skeleton): Built {
  const out = new PartBuilder("leaf");
  const r = ctx.rand.fork("strands");
  const s = ctx.facts.scale ?? 1;
  const crown = crownOf(skel.tips.map((t) => t.position));

  // Strands hang from the tips and from points along the outer limbs.
  const hangs: { at: V3; out: V3 }[] = skel.tips.map((t) => ({ at: [...t.position] as V3, out: [...t.normal] as V3 }));
  const outer = skel.limbs.filter((l) => l.depth >= 1);
  const spacing = (0.3 * s) / (0.5 + p.fullness);
  for (const limb of outer) {
    const span = length(sub(limb.end, limb.start));
    const steps = Math.floor(span / spacing);
    const d = normalize(sub(limb.end, limb.start));
    for (let k = 1; k <= steps; k++) hangs.push({ at: lerp(limb.start, limb.end, k / (steps + 1)), out: d });
  }

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
    // A small crown of leaf clusters around the hang point hides the limb above the curtain.
    const crownCh: Channels = { loss: Math.max(0.01, loss + 0.02), droop: 0.45, wither, glow: 0, pivot: h.at };
    for (let k = 0; k < 2; k++) {
      const d = normalize([sr.range(-1, 1), sr.range(0.1, 0.9), sr.range(-1, 1)]);
      const [side] = basis(d);
      const half = leafLen * 0.9;
      const mid = addScaled(h.at, d, half * 0.4);
      const place = crownPlace(crown, mid);
      const normal = blendNormal(d, place.out, 0.7);
      const shade = 0.75 * (0.8 + 0.3 * clamp(place.depth - 0.3, 0, 1));
      const rows = [-1, 1].map((b) =>
        [-1, 1].map((a): CardPoint => ({ p: add(add(mid, scale(side, a * half)), scale(d, b * half)), across: a, along: b, n: normal, shade })),
      );
      emitCard(out, rows, cutOf(CUT.cluster, sr.next()), crownCh);
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
        const ch: Channels = {
          loss: Math.max(0.01, loss + 0.14 * t),
          droop: 0.45,
          wither: clamp(wither + 0.15 * t, 0, 1),
          glow: 0,
          pivot: h.at,
          tint: strandTint,
        };
        for (const v of row) out.vertex(v.p, v.n, v.shade, ch, [v.across, v.along, cut]);
      });
      for (let k = 0; k < segments; k++) {
        const a = first + k * 2;
        out.triangle(a, a + 2, a + 1);
        out.triangle(a + 1, a + 2, a + 3);
      }
    }
    if (sr.next() < 0.5) {
      const t = sr.range(0.3, 0.75);
      anchors.push({ position: curve(t), normal: outward, size: 1 - t * 0.5 });
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
      emitSpray(out, crown, [lerp(last.start, last.end, 0.1), last.end, add(last.end, [0, 0.35 * s, 0])], p.length * 0.32 * s, cr, p, tipY / top);
      return;
    }
    if (depth >= 2 && p.fullness < 0.7) return;
    const points: Vec3[] = [first.start, ...chain.map((l) => l.end)];
    const tip = points[points.length - 1] as Vec3;
    const width = p.length * (depth === 1 ? 0.5 : 0.36) * s * (0.85 + 0.25 * p.fullness);
    emitSpray(out, crown, points, width, cr, p, tip[1] / top);
    anchors.push({ position: tip, normal: normalize(sub(tip, points[points.length - 2] as Vec3)), size: depth === 1 ? 1 : 0.5 });
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
 * A spray of needles along a limb's polyline: a slim dark core for its mass,
 * and two layered tents of needle cards over it whose combed, jagged fringes
 * droop to either side, so the spray reads as layered needles from the side
 * and from below.
 */
function emitSpray(
  out: PartBuilder,
  crown: Crown,
  points: readonly Vec3[],
  width: number,
  r: Rand,
  p: Resolved<typeof needlesParams>,
  heightFrac: number,
): void {
  const sphere = icosphere(1);
  const first = out.vertexCount;
  const seed = Math.floor(r.next() * 1e6);
  // Lower sprays shed first, as an ailing conifer browns from the bottom up.
  const loss = clamp(lossThreshold(r.next(), 0.5) + 0.12 * (1 - heightFrac), 0.02, 0.7);
  const wither = 0.7 + 0.3 * r.next();
  const tint = r.range(-0.06, 0.06);
  const lift = 0.12 * (p.fullness < 0.9 ? 1 : 0.5) * heightFrac;
  const core = width * 0.5;
  for (const n of sphere.points) {
    // x runs along the limb from just past its base to its tip.
    const t = 0.08 + (n[0] * 0.5 + 0.5) * 0.9;
    const { at, dir } = pointOnPolyline(points, t);
    const side = acrossOf(dir);
    const up = normalize(cross(side, dir));
    const profile = Math.sin(Math.PI * clamp(t * 0.92 + 0.04, 0, 1)) * 0.75 + 0.25;
    const w = core * profile * (1 + 0.18 * fbm3(n[0] * 2.5 + seed * 0.01, n[1] * 2.5, n[2] * 2.5, seed, 2));
    const q = add(at, add(scale(side, n[2] * w), scale(up, (n[1] * 0.4 - 0.28) * w)));
    const place = crownPlace(crown, q);
    const normal = blendNormal([side[0] * n[2] + up[0] * n[1], side[1] * n[2] + up[1] * n[1], side[2] * n[2] + up[2] * n[1]], place.out, 0.5);
    const shade = 0.22 + 0.42 * clamp(place.depth - 0.25, 0, 1) + 0.2 * Math.max(0, n[1]) + 0.5 * tint + lift;
    out.vertex(q, normal, shade, {
      loss: Math.max(0.01, loss + 0.08 * t),
      droop: 0.35,
      wither,
      glow: 0,
      pivot: at,
      tint: tint * 0.4,
    });
  }
  for (const [a, b, c] of sphere.triangles) out.triangle(first + a, first + b, first + c);

  // Two tents: the upper one broad and lifted, the lower one narrower and
  // steeper, so each spray shows a second layer of fringe beneath the first.
  const tents = [
    { from: 0.02, to: 1.0, wide: 1, rise: 0.1, slope: r.range(0.38, 0.55) },
    { from: 0.1, to: 0.92, wide: 0.8, rise: -0.2, slope: r.range(0.7, 0.9) },
  ];
  const rowsAlong = 7;
  for (const tent of tents) {
    const cut = cutOf(CUT.needles, r.next());
    const tentTint = clamp(tint * 0.4 + r.range(-0.02, 0.02), -0.1, 0.1);
    const firstTent = out.vertexCount;
    for (let k = 0; k <= rowsAlong; k++) {
      const v = k / rowsAlong;
      const t = tent.from + (tent.to - tent.from) * v;
      const { at, dir } = pointOnPolyline(points, t);
      const side = acrossOf(dir);
      const up = normalize(cross(side, dir));
      const w = width * tent.wide * (1 - 0.45 * v);
      for (const a of [-1, 0, 1]) {
        const q = add(at, add(scale(side, a * w * Math.cos(tent.slope)), scale(up, tent.rise * width - Math.abs(a) * w * Math.sin(tent.slope))));
        const place = crownPlace(crown, q);
        const normal = blendNormal(normalize(add(up, scale(side, a * 0.6))), place.out, 0.5);
        const shade = 0.3 + 0.42 * clamp(place.depth - 0.25, 0, 1) + 0.1 * (1 - Math.abs(a)) + 0.5 * tint + lift;
        out.vertex(q, normal, shade, {
          loss: Math.max(0.01, loss + 0.08 * t + 0.03 * Math.abs(a)),
          droop: 0.35,
          wither: clamp(wither + 0.1 * Math.abs(a), 0, 1),
          glow: 0,
          pivot: at,
          tint: tentTint,
        }, [a, v, cut]);
      }
    }
    for (let k = 0; k < rowsAlong; k++) {
      for (let j = 0; j < 2; j++) {
        const a = firstTent + k * 3 + j;
        out.triangle(a, a + 3, a + 1);
        out.triangle(a + 1, a + 3, a + 4);
      }
    }
  }
}

// ---------- blossoms ----------

const BLOSSOM_CAP = { petals: 170, pods: 70, berries: 80 } as const;

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
    if (p.form === "petals") {
      const flowers = 3 + Math.floor(ar.next() * 3);
      for (let f = 0; f < flowers; f++) {
        const offset: V3 = [ar.range(-0.3, 0.3) * size, ar.range(-0.15, 0.15) * size, ar.range(-0.3, 0.3) * size];
        const center = add(a.position, offset);
        const facing = normalize(add(a.normal, [ar.range(-0.4, 0.4), 0.5, ar.range(-0.4, 0.4)]));
        emitFlower(out, center, facing, 0.17 * size * ar.range(0.8, 1.2), ar.next() * Math.PI * 2, loss + ar.range(-0.04, 0.04));
      }
    } else if (p.form === "pods") {
      const hang = 0.12 * size;
      const center = add(a.position, [0, -hang - 0.12 * size, 0]);
      emitBall(out, center, [0.065 * size, 0.09 * size, 0.065 * size], 1, { loss, droop: 0.3, wither: 1, glow: 1, pivot: a.position }, 0.55);
      emitStalk(out, a.position, add(center, [0, 0.1 * size, 0]), 0.012 * size, { loss, droop: 0.3, wither: 1, glow: 0, pivot: a.position });
    } else {
      const berries = 4 + Math.floor(ar.next() * 4);
      const out2 = normalize(add(a.normal, [0, -0.6, 0]));
      for (let b = 0; b < berries; b++) {
        const c = add(addScaled(a.position, out2, 0.1 * size), [ar.range(-0.08, 0.08) * size, ar.range(-0.1, 0.04) * size, ar.range(-0.08, 0.08) * size]);
        const rad = 0.045 * size * ar.range(0.8, 1.2);
        emitBall(out, c, [rad, rad, rad], 0, { loss: loss + ar.range(-0.03, 0.03), droop: 0.3, wither: 1, glow: 0, pivot: a.position }, 0.45);
      }
    }
  }
  return { parts: [out.part()], anchors: [] };
}

function emitFlower(out: PartBuilder, center: V3, facing: V3, radius: number, spin: number, loss: number): void {
  const [u, v] = basis(facing);
  const ch: Channels = { loss: clamp(loss, 0.01, 1), droop: 0.5, wither: 1, glow: 0, pivot: center };
  const hub = out.vertex(addScaled(center, facing, radius * 0.15), facing, 0.45, ch);
  for (let k = 0; k < 5; k++) {
    const a0 = spin + (k / 5) * Math.PI * 2;
    const dirAt = (a: number): V3 => add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    const tip = addScaled(addScaled(center, dirAt(a0), radius), facing, radius * 0.25);
    const l = addScaled(center, dirAt(a0 - 0.5), radius * 0.6);
    const rr = addScaled(center, dirAt(a0 + 0.5), radius * 0.6);
    const n = normalize(addScaled(facing, dirAt(a0), 0.35));
    const il = out.vertex(l, n, 0.8, ch);
    const it = out.vertex(tip, n, 1, ch);
    const ir = out.vertex(rr, n, 0.8, ch);
    out.triangle(hub, il, it);
    out.triangle(hub, it, ir);
  }
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
