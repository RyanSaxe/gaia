// One great old tree: the flora frames and crowns grown at a landmark's
// scale, then aged. An ancient tree is lower and broader on a massive,
// buttressed trunk, some of its great limbs are broken off to stubs, and
// its highest limbs stand bare above the crown. In decline its leaves thin
// and drop, its boughs sag and its bark greys to a bare snag.

import type { Anchor, BuildContext, Built, Limb, Resolved, Skeleton } from "@gaia/schema";
import type { greatTreeParams } from "../../landmark.ts";
import { PartBuilder, type V3, clamp, cross, dot, fbm3, normalize, sub } from "../kit.ts";
import { growBranching } from "../skeleton.ts";
import { buildBark, buildLeafClumps, buildLeafStrands } from "../foliage.ts";

type TreeParams = Resolved<typeof greatTreeParams>;

/** How each form grows: its frame, and the crown on it. */
const FORMS = {
  "a spreading oak": { frame: { habit: "spreading", density: 5, spread: 44, stature: 0.95 }, crown: "clumps", leaf: "lobed", shape: "round", bole: 1 },
  "a tall elm": { frame: { habit: "upright", density: 5, spread: 34, stature: 1.25 }, crown: "clumps", leaf: "oval", shape: "round", bole: 1 },
  "a great willow": { frame: { habit: "weeping", density: 4, spread: 46, stature: 0.95 }, crown: "strands", leaf: "pointed", shape: "round", bole: 1 },
  "an umbrella pine": { frame: { habit: "spreading", density: 4, spread: 50, stature: 0.72 }, crown: "clumps", leaf: "pointed", shape: "round", bole: 2.2 },
  "a dark yew": { frame: { habit: "spreading", density: 5, spread: 52, stature: 0.72 }, crown: "clumps", leaf: "oval", shape: "round", bole: 1 },
} as const;

/**
 * Ages a frame: `age` 0 is a young giant, slim and reaching; 1 is ancient,
 * squat on a massive trunk that forks low, with buttress roots, great limbs
 * broken to stubs and its highest limbs bare. `bole` stretches the bare
 * trunk below the crown. Returns the aged frame and the tips that still
 * carry leaves.
 */
function aged(skel: Skeleton, age: number, bole: number, broken: (i: number) => boolean): { skeleton: Skeleton; buttresses: Buttress[]; trunkRadius: number } {
  const trunk = skel.limbs.filter((l) => l.depth === 0);
  const fork = trunk.reduce((m, l) => Math.max(m, l.end[1]), 0);
  // The fork drops and the trunk thickens with age; the crown above moves with the fork.
  const stretch = bole * (1 - 0.38 * age);
  // The trunk stretches; the crown moves with the fork, whole, except that a
  // crown lowered with age never sinks a drooping limb below where it hung.
  const lower = (q: readonly [number, number, number], trunk = false): V3 => {
    const moved = trunk || (stretch < 1 && q[1] <= fork) ? q[1] * stretch : q[1] + fork * (stretch - 1);
    return [q[0], moved, q[2]];
  };
  const girth = (l: Limb): number => (l.depth === 0 ? 0.85 + 0.75 * age : l.depth === 1 ? 0.9 + 0.4 * age : 1);
  // Great limbs broken off: the first segment stays as a blunt stub and everything it carried is gone.
  const stubs = new Set<number>();
  const gone = new Set<number>();
  skel.limbs.forEach((l, i) => {
    if (gone.has(l.parent) || stubs.has(l.parent)) gone.add(i);
    else if (l.depth === 1 && skel.limbs[l.parent]?.depth === 0 && broken(i)) stubs.add(i);
  });
  const removed = (i: number): boolean => gone.has(i);
  const kept = new Map<number, number>();
  const limbs: Limb[] = [];
  skel.limbs.forEach((l, i) => {
    if (removed(i)) return;
    kept.set(i, limbs.length);
    const start = lower(l.start, l.depth === 0);
    let end = lower(l.end, l.depth === 0);
    let endRadius = l.endRadius * girth(l);
    if (stubs.has(i)) {
      end = [start[0] + (end[0] - start[0]) * 0.5, start[1] + (end[1] - start[1]) * 0.5, start[2] + (end[2] - start[2]) * 0.5];
      endRadius = l.startRadius * girth(l) * 0.75;
    }
    limbs.push({ start, end, startRadius: l.startRadius * girth(l), endRadius, depth: l.depth, parent: l.parent < 0 ? -1 : (kept.get(l.parent) ?? -1) });
  });
  // Buttress roots spread into the ground around an old trunk.
  const base = limbs[0];
  const buttresses: Buttress[] = [];
  if (base !== undefined && age > 0.3) {
    const roots = 4 + Math.round(age * 3);
    for (let k = 0; k < roots; k++) {
      const a = (k / roots) * Math.PI * 2 + 0.4 * Math.sin(k * 2.3);
      const size = 0.8 + 0.3 * Math.cos(k * 1.7);
      buttresses.push({
        angle: a,
        reach: base.startRadius * (1.5 + 0.9 * age) * size,
        height: base.startRadius * (1.3 + 0.8 * age) * BUTTRESS.height * (0.85 + 0.3 * Math.cos(k * 2.9)),
        thick: base.startRadius * BUTTRESS.thick,
      });
    }
  }
  // Tips on what remains carry leaves, but an ancient crown's highest limbs stand bare.
  const ends = new Map<string, number>();
  skel.limbs.forEach((l, i) => ends.set(l.end.join(","), i));
  const top = skel.tips.reduce((m, t) => Math.max(m, t.position[1]), 0);
  const bare = age > 0.6 ? top - (top - fork) * 0.14 * (age - 0.6) * 2.5 : Infinity;
  const tips: Anchor[] = skel.tips.flatMap((t) => {
    const i = ends.get(t.position.join(","));
    if (i !== undefined && (removed(i) || stubs.has(i))) return [];
    if (t.position[1] > bare) return [];
    return [{ ...t, position: lower(t.position) }];
  });
  return { skeleton: { limbs, tips }, buttresses, trunkRadius: base?.startRadius ?? 0.5 };
}

/** A blade-like buttress root, in meters: where it points, how far it runs, how tall it stands at the trunk and how thick it is. */
interface Buttress {
  readonly angle: number;
  readonly reach: number;
  readonly height: number;
  readonly thick: number;
}

/**
 * How an old trunk's buttresses stand, against its width: they run as far
 * as its round roots did, stand `height` times as tall where they leave the
 * trunk, are `thick` of its radius across, and their top edge falls to the
 * ground as the `sweep` power of the way out.
 */
const BUTTRESS = { height: 1.6, thick: 0.2, sweep: 1.6 } as const;

/**
 * An old trunk's buttress roots: each a thin blade that leaves the trunk
 * tall, curving a little as it runs out, its top edge sweeping down to the
 * ground and its foot sunk into it. Bark like the trunk's, never lost, and
 * swaying with the trunk's base.
 */
function buildButtresses(buttresses: readonly Buttress[], trunkRadius: number, roughness: number, seed: number): Built {
  const out = new PartBuilder("bark", "solid");
  const along = 14;
  const around = 12;
  const root: V3 = [0, 0, 0];
  buttresses.forEach((b, n) => {
    const grid: V3[][] = [];
    const centers: V3[] = [];
    for (let i = 0; i <= along; i++) {
      const t = i / along;
      const a = b.angle + 0.16 * Math.sin(t * Math.PI * 1.3 + n * 1.9);
      const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
      const side: V3 = [-dir[2], 0, dir[0]];
      const dist = trunkRadius * 0.3 + t * Math.max(0, b.reach - trunkRadius * 0.3);
      const top = b.height * Math.pow(1 - t, BUTTRESS.sweep) + 0.06;
      const bottom = -0.4;
      const half = (top - bottom) / 2;
      const mid = (top + bottom) / 2;
      // Thicker where it leaves the trunk, thinning as it runs out.
      const w = b.thick * (1 - 0.55 * t) * (1 + 1.2 * Math.exp(-t * 7));
      centers.push([dir[0] * dist, mid, dir[2] * dist]);
      const row: V3[] = [];
      for (let j = 0; j <= around; j++) {
        const th = (j / around) * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        // Flat-sided, its top edge rounded, a little wider toward the ground.
        const across = w * Math.sign(c) * Math.pow(Math.abs(c), 0.55) * (1.25 - 0.25 * s);
        const up = mid + half * Math.sign(s) * Math.pow(Math.abs(s), 0.3);
        row.push([dir[0] * dist + side[0] * across, up, dir[2] * dist + side[2] * across]);
      }
      grid.push(row);
    }
    const first = out.vertexCount;
    const wither = 0.5 + 0.2 * Math.abs(Math.sin(n * 2.1));
    const normals: V3[][] = [];
    for (let i = 0; i <= along; i++) {
      normals.push([]);
      for (let j = 0; j <= around; j++) {
        const q = (grid[i] as V3[])[j] as V3;
        const du = sub((grid[Math.min(along, i + 1)] as V3[])[j] as V3, (grid[Math.max(0, i - 1)] as V3[])[j] as V3);
        const dv = sub((grid[i] as V3[])[(j + 1) % around] as V3, (grid[i] as V3[])[(j + around - 1) % around] as V3);
        let nrm = normalize(cross(du, dv));
        if (dot(nrm, sub(q, centers[i] as V3)) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
        (normals[i] as V3[]).push(nrm);
        const wobble = fbm3(q[0] * 1.7, q[1] * 0.8, q[2] * 1.7, seed + n, 2);
        const furrow = 0.5 + 0.5 * Math.sin(q[1] * 2.4 + wobble * 3 + (i / along) * 6);
        const ground = clamp(q[1] / 1.2, 0, 1);
        const shade = (0.5 + 0.28 * (1 - roughness * 0.6) + 0.22 * furrow * (0.3 + roughness)) * (0.82 + 0.18 * ground) + 0.06 * wobble;
        out.vertex(q, nrm, clamp(shade, 0, 1), { loss: 0, droop: 0, wither, glow: 0, pivot: root, bough: root });
      }
    }
    // Wound counter-clockwise seen from outside: each quad's face agrees with its corners' normals.
    for (let i = 0; i < along; i++) {
      for (let j = 0; j < around; j++) {
        const a = first + i * (around + 1) + j;
        const c = a + around + 1;
        const p0 = (grid[i] as V3[])[j] as V3;
        const face = cross(sub((grid[i] as V3[])[j + 1] as V3, p0), sub((grid[i + 1] as V3[])[j] as V3, p0));
        const corners = [normals[i]?.[j], normals[i]?.[j + 1], normals[i + 1]?.[j], normals[i + 1]?.[j + 1]] as V3[];
        const facing = corners.reduce((sum, m) => sum + dot(face, m), 0);
        if (facing >= 0) {
          out.triangle(a, a + 1, c);
          out.triangle(a + 1, c + 1, c);
        } else {
          out.triangle(a, c, a + 1);
          out.triangle(a + 1, c, c + 1);
        }
      }
    }
  });
  return { parts: out.vertexCount > 0 ? [out.part()] : [], anchors: [] };
}

/**
 * One great old tree, four or five times a person's reach across, of the
 * chosen form and age. It declines as a flora tree does, to a bare grey snag.
 */
/**
 * A great tree's crown, at most: twice a tree's, so its crown fills out
 * across every limb. A great tree stands alone and a person walks up to it,
 * but its crown fills much of the screen, so each layer of leaf cards costs
 * its whole area to draw: at the density its size would call for (about
 * 160,000 triangles for an oak) it drew 2.5 times as many card layers as a
 * tree's ceiling allows, and the frame paid for it.
 */
const CROWN_GUARD = 48_000;

export function buildGreatTree(p: TreeParams, ctx: BuildContext): Built {
  const form = FORMS[p.form];
  // A young giant stands a little taller; an ancient one spreads lower and wider.
  const scale = p.size * (ctx.facts.scale ?? 1) * (1.06 - 0.12 * p.age);
  const inner: BuildContext = { rand: ctx.rand.fork("great-tree"), facts: { ...ctx.facts, scale } };
    const grown = growBranching({ ...form.frame, spread: form.frame.spread * (1 + 0.18 * p.age), stature: form.frame.stature * (1.08 - 0.2 * p.age) }, inner);
  const breaks = inner.rand.fork("broken");
  const odds = clamp((p.age - 0.3) * 0.75, 0, 0.5);
  const { skeleton, buttresses, trunkRadius } = aged(grown, p.age, form.bole, () => breaks.next() < odds);
  const roughness = clamp(p.bark + 0.25 * p.age, 0, 1);
  const bark = buildBark({ roughness }, { ...inner, rand: inner.rand.fork("bark") }, skeleton);
  const roots = buildButtresses(buttresses, trunkRadius, roughness, Math.floor(inner.rand.fork("roots").next() * 1e6));
  const fullness = p.fullness * (1 - 0.18 * p.age);
  const crown =
    form.crown === "strands"
      ? buildLeafStrands({ length: 2.2, fullness }, { ...inner, rand: inner.rand.fork("crown") }, skeleton)
      : buildLeafClumps({ shape: form.shape, leaf: form.leaf, size: 1, fullness }, { ...inner, rand: inner.rand.fork("crown") }, skeleton, CROWN_GUARD);
  return { parts: [...bark.parts, ...roots.parts, ...crown.parts], anchors: crown.anchors };
}
