// Builds a fallen log and a stump with the trees' bark (`barkAt`) and root
// flare (`flareOf`), so both look like they came from a tree in this world.
// Each body is two halves split down the middle, which meet exactly at full
// vitality and sag apart (`droop`) into the turf as vitality falls. A log's
// bark plates also drop away (`loss`) to grey wood and its stubs break off,
// and a stump's top crumbles into a dark hollow.

import type { Anchor, BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { fallenLogParams, stumpParams } from "../rock.ts";
import { barkAt, flareOf, lobesOf } from "./foliage.ts";
import { type Channels, PartBuilder, type V3, add, addScaled, clamp, cross, fbm3, normalize, scale, sub } from "./kit.ts";

const UP: V3 = [0, 1, 0];
/** Where the bark ends and the wood begins, as a share of the stem's radius. It is just inside the deepest furrow, so rough bark is thick and smooth bark thin. */
const woodOf = (roughness: number): number => 0.97 - 0.13 * roughness;

/** One ring of a stem: its center, axis and frame (`v` is `d × u`), its smooth radius, and how far a cut or broken end stands past it. */
interface Station {
  readonly c: V3;
  readonly d: V3;
  readonly u: V3;
  readonly v: V3;
  readonly along: number;
  readonly radius: (theta: number) => number;
  /** Along `d`, at `theta` and share `s` of the radius. Zero except at an end. */
  readonly end: (theta: number, s: number) => number;
  /** The sawn face's pith offset from the center. Its rings close on it. */
  readonly pith?: V3;
  /** Where its bark ends and its wood begins, as a share of its radius (`woodOf`). */
  readonly wood: number;
  /** How much of a knot's dark eye lies at `theta`, 0 to 1. None when absent. */
  readonly knot?: (theta: number) => number;
}

interface Stem {
  readonly stations: readonly Station[];
  readonly roughness: number;
  readonly seed: number;
  readonly furrows: number;
  /** Segments around each half. */
  readonly half: number;
  /** One half spans `split` to `split + π` around the axis, and the other half the rest. */
  readonly split: number;
}

type End = "sawn" | "broken";

const around = (st: Station, theta: number): V3 => add(scale(st.u, Math.cos(theta)), scale(st.v, Math.sin(theta)));
const ringPoint = (st: Station, theta: number, s: number): V3 =>
  addScaled(addScaled(st.c, around(st, theta), st.radius(theta) * s), st.d, st.end(theta, Math.min(s, 1)));
const capPoint = (st: Station, theta: number, s: number): V3 =>
  st.pith === undefined || s >= st.wood ? ringPoint(st, theta, s) : addScaled(ringPoint(st, theta, s), st.pith, 1 - s / st.wood);

/** The bark's surface on station `i` at `theta`: the trees' ridges over the smooth stem, and their shade. */
function barkPoint(stem: Stem, i: number, theta: number): { q: V3; shade: number } {
  const st = stem.stations[i] as Station;
  const smooth = ringPoint(st, theta, 1);
  const { bump, shade } = barkAt(stem.roughness, stem.seed, stem.furrows, st.c, theta, st.along, smooth[1]);
  return { q: ringPoint(st, theta, 1 + bump), shade: shade - 0.35 * (st.knot?.(theta) ?? 0) };
}

/** Smooth vertex normals from a grid's own faces. */
function faceNormals(rows: readonly (readonly V3[])[]): V3[][] {
  const acc = rows.map((row) => row.map((): V3 => [0, 0, 0]));
  const put = (i: number, j: number, f: V3): void => {
    const a = acc[i]?.[j] as V3;
    a[0] += f[0];
    a[1] += f[1];
    a[2] += f[2];
  };
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < (rows[0]?.length ?? 0); j++) {
      const [a, a1, b, b1] = [rows[i]?.[j], rows[i]?.[j + 1], rows[i + 1]?.[j], rows[i + 1]?.[j + 1]] as V3[];
      const f1 = cross(sub(a1 as V3, a as V3), sub(b as V3, a as V3));
      const f2 = cross(sub(b1 as V3, a1 as V3), sub(b as V3, a1 as V3));
      for (const [ii, jj] of [[i, j], [i, j + 1], [i + 1, j]] as const) put(ii, jj, f1);
      for (const [ii, jj] of [[i, j + 1], [i + 1, j + 1], [i + 1, j]] as const) put(ii, jj, f2);
    }
  }
  return acc.map((row) => row.map(normalize));
}

interface Look {
  readonly shade: number;
  readonly tint?: number;
}

/** The decline channels for each vertex of a grid, by row and column. */
type Carry = (row: number, col: number) => Channels;

/** A grid of rows of points, its front facing (along a row) × (down the rows). */
function emitGrid(out: PartBuilder, rows: readonly (readonly V3[])[], look: (i: number, j: number) => Look, carry: Carry, normals = faceNormals(rows)): void {
  const cols = rows[0]?.length ?? 0;
  const first = out.vertexCount;
  rows.forEach((row, i) => row.forEach((p, j) => {
    const l = look(i, j);
    out.vertex(p, normals[i]?.[j] ?? UP, l.shade, { ...carry(i, j), tint: l.tint ?? 0 });
  }));
  // A row that closes to one point, a face's center or a hollow's floor, takes one triangle per segment, not two.
  const same = (a: V3 | undefined, b: V3 | undefined): boolean => a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const a = first + i * cols + j;
      if (!same(rows[i]?.[j], rows[i]?.[j + 1])) out.triangle(a, a + 1, a + cols);
      if (!same(rows[i + 1]?.[j], rows[i + 1]?.[j + 1])) out.triangle(a + 1, a + cols + 1, a + cols);
    }
  }
}

/**
 * Cuts a grid into plates that meet edge to edge: columns at `colCuts`, and
 * each column's rows at its own cuts, so the plates break joint. Each plate
 * collapses to its own center below the vitality `lossOf` gives from its row
 * band and facing. `ragged` shifts each vertex's threshold a little, so the
 * plate goes with a soft, uneven edge. A plate with a `backing` gets a dark
 * inner face in the backing's builder, so once its neighbors have gone nobody
 * sees through its inside, which is front-faced only.
 */
function emitPlates(
  out: PartBuilder, rows: readonly (readonly V3[])[], normals: readonly (readonly V3[])[], look: (i: number, j: number) => Look, carry: Carry,
  rowCutsOf: (col: number) => readonly number[], colCuts: readonly number[], lossOf: (band: number, facing: V3, col: number) => number,
  backing?: { readonly out: PartBuilder; readonly rows: readonly (readonly V3[])[] },
  ragged: (p: V3) => number = () => 0,
): void {
  for (let b = 0; b + 1 < colCuts.length; b++) {
    const rowCuts = rowCutsOf(b);
    for (let a = 0; a + 1 < rowCuts.length; a++) {
      const [i0, i1, j0, j1] = [rowCuts[a], rowCuts[a + 1], colCuts[b], colCuts[b + 1]] as [number, number, number, number];
      if (i1 <= i0) continue;
      const pick = <T>(grid: readonly (readonly T[])[]): T[][] => grid.slice(i0, i1 + 1).map((row) => row.slice(j0, j1 + 1));
      const [mi, mj] = [Math.round((i0 + i1) / 2), Math.round((j0 + j1) / 2)];
      const loss = lossOf(a, normals[mi]?.[mj] ?? UP, b);
      const middle = rows[mi]?.[mj] as V3;
      const held = (i: number, j: number): Channels => {
        const at = rows[i0 + i]?.[j0 + j] as V3;
        return { ...carry(i0 + i, j0 + j), loss: loss > 0 ? clamp(loss + ragged(at), 0.02, 0.95) : 0, pivot: middle };
      };
      emitGrid(out, pick(rows), (i, j) => look(i0 + i, j0 + j), held, pick(normals));
      const cols = j1 - j0;
      if (backing !== undefined) emitGrid(backing.out, pick(backing.rows).map((row) => row.reverse()), () => ({ shade: 0.08, tint: 0.02 }), (i, j) => held(i, cols - j));
    }
  }
}

/** Every `step`th index from 0 to `last`, always ending on `last`. */
const cutsOf = (last: number, step: number): number[] => [...Array.from({ length: Math.ceil(last / step) }, (_, k) => k * step), last];

/** A cut face's rings, from its rim in to the pith: a dark line of late wood at each ring's outer edge, a lighter heartwood inside. */
function sawnRings(radius: number, wood: number): { s: number; shade: number; tint: number }[] {
  const count = clamp(Math.round(radius / 0.04), 4, 9);
  const heart = (s: number): number => 1 - clamp((s - 0.4) / 0.2, 0, 1);
  const base = (s: number): number => 0.56 + 0.18 * heart(s);
  const out = [{ s: wood, shade: base(wood) - 0.16, tint: -0.01 }];
  for (let k = count - 1; k >= 1; k--) {
    const b = 0.06 + (wood - 0.06) * Math.pow(k / count, 0.85);
    out.push({ s: b + 0.012, shade: base(b) + 0.04, tint: 0.015 * heart(b) - 0.008 }, { s: b - 0.012, shade: base(b) - 0.2, tint: 0.015 * heart(b) - 0.008 });
  }
  out.push({ s: 0.05, shade: 0.76, tint: 0.015 }, { s: 0, shade: 0.48, tint: 0.01 });
  return out;
}

/** A broken face's rings, from the wood's edge to the center. */
const brokenRings = (wood: number): number[] => [wood, 0.62, 0.38, 0.17, 0];

/** How a broken end splinters past its ring: a tongue of long splinters on one side, ragged everywhere, closing to one point at the center. */
function brokenEnd(radius: number, seed: number, hinge: number, reach: number): (theta: number, s: number) => number {
  return (theta, s) => {
    const tongue = Math.pow(Math.max(0, Math.cos(theta - hinge)), 3);
    const jag = Math.pow(clamp(0.5 + 0.9 * fbm3(Math.cos(theta) * 2.6, Math.sin(theta) * 2.6, s * 2.2 + 3, seed, 2), 0, 1), 1.5);
    const open = clamp(s / 0.35, 0, 1);
    return radius * reach * (0.08 + open * (1.1 * tongue * (0.35 + 0.65 * s) + 0.45 * jag) + 0.25 * (1 - open));
  };
}

/** The angles one half spans, in order around the axis, or reversed for a face seen from behind. */
const halfAngles = (stem: Stem, h: number, reversed = false): number[] => {
  const out = Array.from({ length: stem.half + 1 }, (_, j) => stem.split + h * Math.PI + (j * Math.PI) / stem.half);
  return reversed ? out.reverse() : out;
};

/** A capped station: which way its face looks along the stem, sawn or broken, and for a crumbling face, when each plate goes, by band from the rim (0) to the center (2). */
interface Cap {
  readonly i: number;
  readonly facing: 1 | -1;
  readonly look: End;
  readonly crumble?: (band: number, col: number) => number;
  /** The rotten hollow under a face that crumbles, at `theta` and share `s` of the radius. The split's face follows it. */
  readonly hollow?: (theta: number, s: number) => V3;
}

/** How one half's bark sheds: plate width in segments, each column's cuts along the stem, and the vitality at which a plate with a given facing drops away. */
interface Shed {
  readonly cols: number;
  readonly rowsOf: (col: number) => readonly number[];
  readonly loss: (facing: V3) => number;
  readonly ragged: (p: V3) => number;
  /** The checks in the wood under the bark: how deep a crack runs at a station and a column of the fine grid, 0 to 1. */
  readonly check: (i: number, j: number) => number;
}

/**
 * One half of a stem: its bark, the grey wood under bark that sheds, the
 * face of its split, and its end faces. `hollow` gives where the split's face
 * crosses a rotten hollow, by station and share of the radius.
 */
function emitHalf(bark: PartBuilder, wood: PartBuilder, stem: Stem, h: number, carry: Carry, shed: Shed | null, ends: readonly Cap[], hollow = (_i: number, _s: number): boolean => false): void {
  const st = stem.stations;
  const thetas = halfAngles(stem, h);
  const smooth = (i: number, theta: number): V3 => ringPoint(st[clamp(i, 0, st.length - 1)] as Station, theta, 1);
  const rows = st.map((_, i) => thetas.map((theta) => barkPoint(stem, i, theta)));
  const step = Math.PI / stem.half / 2;
  const normals = st.map((_, i) =>
    thetas.map((theta) => normalize(cross(sub(smooth(i, theta + step), smooth(i, theta - step)), sub(smooth(i + 1, theta), smooth(i - 1, theta))))),
  );
  const points = rows.map((row) => row.map((b) => b.q));
  // Noise mottles old bark, like lichen and damp.
  const mottle = (i: number, j: number): number => fbm3((st[i] as Station).along * 1.1, Math.cos(thetas[j] as number) * 1.4, Math.sin(thetas[j] as number) * 1.4, stem.seed + 41, 2);
  const barkLook = (i: number, j: number): Look => ({ shade: (rows[i]?.[j]?.shade ?? 0.5) + 0.08 * mottle(i, j), tint: 0.015 * mottle(i, j) });
  if (shed === null) emitGrid(bark, points, barkLook, carry, normals);
  else {
    // The inner face lies just under the outer, so a plate seen from inside looks like dark inner bark from any angle.
    // It is drawn in the wood part, so moss grows only on the bark's outer face.
    const inner = points.map((row, i) => row.map((q, j) => addScaled(q, around(st[i] as Station, thetas[j] as number), -0.02 * (st[i] as Station).radius(thetas[j] as number))));
    emitPlates(bark, points, normals, barkLook, carry, shed.rowsOf, cutsOf(stem.half, shed.cols), (_band, facing) => shed.loss(facing), { out: wood, rows: inner }, shed.ragged);
    // The wood under the bark, weathered and checked along its grain, on twice the bark's segments so a check is a
    // crease rather than a band. A check's floor sags a little more than the wood beside it, so it opens as vitality falls.
    const fine = Array.from({ length: stem.half * 2 + 1 }, (_, j) => stem.split + h * Math.PI + (j * Math.PI) / (stem.half * 2));
    emitGrid(wood, st.map((s, i) => fine.map((theta, j) => ringPoint(s, theta, s.wood * (1 - 0.05 * shed.check(i, j))))), (i, j) => ({
      shade: 0.42 + 0.14 * fbm3((st[i] as Station).along * 0.9, (fine[j] as number) * 3.1, 0, stem.seed + 11, 2) - 0.4 * shed.check(i, j), tint: -0.01,
    }), (i, j) => {
      const held = carry(i, j);
      return { ...held, droop: held.droop + 0.06 * shed.check(i, j), wither: 0.95 };
    });
  }

  const capOf = (i: number): Cap | undefined => ends.find((e) => e.i === i);
  for (const e of ends) {
    const at = st[e.i] as Station;
    const angles = halfAngles(stem, h, e.facing < 0);
    const rings = e.look === "sawn" ? sawnRings(at.radius(0), at.wood) : brokenRings(at.wood).map((s) => ({ s, shade: 0, tint: -0.005 }));
    // A band of bark from its ragged edge to the wood, then the face ring by ring to the center.
    const rim = angles.map((theta) => barkPoint(stem, e.i, theta).q);
    const jitter = (theta: number, s: number, k: number): number =>
      e.look === "sawn" && s < at.wood && s > 0 ? s * (1 + 0.03 * fbm3(Math.cos(theta) * 1.5, Math.sin(theta) * 1.5, k * 0.7, stem.seed + 5, 2)) : s;
    const face = rings.map((ring, k) => angles.map((theta) => capPoint(at, theta, jitter(theta, ring.s, k))));
    const held = (): Channels => carry(e.i, 0);
    emitGrid(bark, [rim, face[0] as V3[]], () => ({ shade: 0.22 }), held);
    const reach = Math.max(0.05, at.radius(0));
    const look = (k: number, j: number): Look => {
      const ring = rings[k] as { s: number; shade: number; tint: number };
      if (e.look === "sawn") return ring;
      const theta = angles[j] as number;
      const splinter = clamp((at.end(theta, ring.s) * e.facing) / reach - 0.15, 0, 1);
      return { shade: 0.46 + 0.4 * splinter + 0.06 * fbm3(Math.cos(theta) * 4, Math.sin(theta) * 4, ring.s * 3, stem.seed + 7, 1), tint: ring.tint };
    };
    const cut = (): Channels => ({ ...held(), wither: 0.85 });
    if (e.crumble === undefined) emitGrid(wood, face, look, cut);
    else {
      // Bands from the rim to the center, six pieces around the half, their edges staggered a ring or two and each
      // piece going a little unevenly, so the face crumbles in soft-edged pieces.
      const bandOf = [0.6, 0.3].map((s) => rings.findIndex((ring) => ring.s < s));
      const stagger = rings.length > 8 ? 2 : 0;
      const crumble = e.crumble;
      const rowsOf = (col: number): number[] => [0, ...bandOf.map((at, k) => Math.round(clamp(at + stagger * Math.sin(col * 0.8 + k * 2.1 + stem.seed), 1, rings.length - 2))), rings.length - 1];
      const soft = (q: V3): number => 0.06 * fbm3(q[0] * 9, q[1] * 9, q[2] * 9, stem.seed + 61, 2);
      emitPlates(wood, face, faceNormals(face), look, cut, rowsOf, cutsOf(stem.half, 1), (band, _facing, col) => crumble(band, col), undefined, soft);
    }
  }

  // The split's face, across the stem from one edge of the half to the other. It shows only once the halves part.
  // A broken end's face is ragged, so the split's face meets it at every one of its rings. Where bark sheds, the
  // face stops at the wood, so no edge of it sticks up like a fin once the bark has gone.
  const share = (st[0] as Station).wood;
  const columns = ends.some((e) => e.look === "broken") ? brokenRings(share) : [share, 0.5, 0];
  const edge = shed === null ? [1] : [];
  const shareOf = [...edge, ...columns, ...columns.slice().reverse().slice(1), ...edge];
  const [near, far] = [thetas[thetas.length - 1] as number, thetas[0] as number];
  const across = (i: number): V3[] => {
    const station = st[i] as Station;
    const cap = capOf(i);
    const sink = cap?.hollow;
    const point = cap === undefined ? ringPoint : sink === undefined ? capPoint : (at: Station, theta: number, s: number): V3 => (s < at.wood ? sink(theta, s) : capPoint(at, theta, s));
    const side = (theta: number): V3[] => [...(shed === null ? [barkPoint(stem, i, theta).q] : []), ...columns.map((s) => point(station, theta, s))];
    return [...side(near), ...side(far).reverse().slice(1)];
  };
  emitGrid(wood, st.map((_, i) => across(i)), (i, j) => {
    const s = shareOf[j] ?? 1;
    const streak = fbm3((st[i] as Station).along * 0.7, j * 0.9, h * 5, stem.seed + 9, 2);
    return { shade: s >= 1 ? 0.2 : hollow(i, s) ? 0.12 : 0.58 + 0.12 * streak, tint: -0.005 };
  }, (i) => ({ ...carry(i, 0), wither: 0.85 }));
}

/** A stem's frame on axis `d`, with `u` as near `toward` as the axis allows. */
function frame(d: V3, toward: V3): { u: V3; v: V3 } {
  const u = normalize(addScaled(toward, d, -(toward[0] * d[0] + toward[1] * d[1] + toward[2] * d[2])));
  return { u, v: cross(d, u) };
}

const sizeOf = (ctx: BuildContext): number => 0.75 + 0.25 * (ctx.facts.scale ?? 1);

/**
 * Channels for a half that sags as vitality falls, about a line on the ground
 * beyond the other half, `reach` across from its own side `n` under `at`. It
 * settles into the turf, and its top leans out from the split.
 */
const sagging = (at: V3, n: V3, reach: number, droop: number, wither: number): Channels => {
  const bough: V3 = [at[0] - n[0] * reach, at[1], at[2] - n[2] * reach];
  return { loss: 0, droop, wither, glow: 0, pivot: bough, bough };
};

/** How far each half sags at vitality 0, one farther than the other, so they part unevenly. */
const SAG = { log: [0.18, 0.11], stump: [0.12, 0.08] } as const;

// ---------- fallen log ----------

export function buildFallenLog(p: Resolved<typeof fallenLogParams>, ctx: BuildContext): Built {
  const bark = new PartBuilder("bark", "solid");
  const wood = new PartBuilder("wood");
  const r = ctx.rand.fork("log");
  const k = sizeOf(ctx);
  const length = p.length * k;
  const girth = p.girth * k;
  const seed = Math.floor(r.next() * 1e6);
  const count = clamp(Math.round(length / (girth * 0.7)) + 1, 8, 24);
  // A fallen trunk that tapers from a foot flaring into the stubs of its root lobes, bends a little along its
  // length, and sags into the turf along its middle.
  const flare = flareOf(girth, lobesOf(r.fork("lobes")), 0.45, 0.7);
  const flared = (along: number, theta: number): number => 1 + 0.35 * (flare.at(along, theta) - 1);
  const flaredMean = (along: number): number => Array.from({ length: 8 }, (_, a) => flared(along, (a / 8) * Math.PI * 2)).reduce((x, y) => x + y, 0) / 8;
  const radiusAt = (t: number): number => girth * (1.12 - 0.42 * t) * (1 + 0.06 * fbm3(t * 2.2, 0, 0, seed, 2));
  const bend = (r.next() < 0.5 ? -1 : 1) * r.range(0.04, 0.09) * length;
  const wiggle = r.next() * Math.PI * 2;
  const sag = girth * r.range(0.1, 0.2);
  const centerAt = (t: number): V3 => [
    (t - 0.5) * length,
    radiusAt(t) * flaredMean(t * length) * 0.76 - sag * Math.sin(Math.PI * t),
    bend * Math.sin(Math.PI * t) + 0.25 * bend * Math.sin(3 * Math.PI * t + wiggle),
  ];
  // Knots where boughs once grew: low swellings with a dark eye, mostly on its upper side.
  const knots = Array.from({ length: 2 + Math.round(length / 1.2) }, (_, n) => {
    const kr = r.fork(`knot${n}`);
    return { along: kr.range(0.15, 0.95) * length, theta: Math.PI / 2 + kr.range(-1.6, 1.6), size: kr.range(0.7, 1.2) };
  });
  const knotAt = (along: number, theta: number): number =>
    knots.reduce((most, kn) => {
      const da = (along - kn.along) / (girth * 0.55 * kn.size);
      const dt = Math.atan2(Math.sin(theta - kn.theta), Math.cos(theta - kn.theta)) / (0.32 * kn.size);
      return Math.max(most, Math.exp(-da * da - dt * dt));
    }, 0);
  const looks: Record<typeof p.ends, readonly [End, End]> = { sawn: ["sawn", "sawn"], broken: ["broken", "broken"], "one of each": ["sawn", "broken"] };
  const [butt, crown] = looks[p.ends];
  const tilt = r.range(-0.07, 0.07);
  const tiltAt = r.next() * Math.PI * 2;
  const stations: Station[] = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const along = t * length;
    const d = normalize(sub(centerAt(Math.min(1, t + 0.02)), centerAt(Math.max(0, t - 0.02))));
    const { u, v } = frame(d, cross(UP, d));
    const rad = radiusAt(t);
    // A lying log is a little flatter than round, with burls and knots along it.
    const radius = (theta: number): number =>
      rad * flared(along, theta) * (1 + 0.04 * Math.cos(2 * theta) + 0.05 * fbm3(along * 1.3, Math.cos(theta) * 1.2, Math.sin(theta) * 1.2, seed + 21, 2) + 0.12 * knotAt(along, theta));
    const look = i === 0 ? butt : i === count - 1 ? crown : undefined;
    const facing = i === 0 ? -1 : 1;
    const broken = brokenEnd(rad, seed + i, r.next() * Math.PI * 2, 0.8);
    const end = look === undefined ? () => 0 : look === "sawn" ? (theta: number, s: number) => facing * radius(theta) * s * tilt * Math.cos(theta - tiltAt) : (theta: number, s: number) => facing * broken(theta, s);
    const pith = look === "sawn" ? addScaled(scale(u, Math.cos(tiltAt) * rad * 0.07), v, Math.sin(tiltAt) * rad * 0.07) : undefined;
    const knot = (theta: number): number => clamp((knotAt(along, theta) - 0.55) / 0.35, 0, 1);
    return { c: centerAt(t), d, u, v, along, radius, end, wood: woodOf(p.bark), knot, ...(pith === undefined ? {} : { pith }) };
  });
  const half = 10;
  const stem: Stem = { stations, roughness: p.bark, seed, furrows: 7, half, split: -Math.PI / 2 };
  // Each half sags about a line along the ground beyond the other half, so it sinks as it parts.
  const reach = girth * 3.2;
  const carries: Carry[] = [1, -1].map((side, h) => (i) => {
    const st = stations[i] as Station;
    return sagging([st.c[0], 0, st.c[2]], scale(st.u, side), reach, SAG.log[h] as number, 0.7);
  });
  const ends = [{ i: 0, facing: -1 as const, look: butt }, { i: count - 1, facing: 1 as const, look: crown }];
  carries.forEach((carry, h) => {
    // Bark weathers off the top first and stays longer low down, where it lies damp. The lowest bark never goes.
    const strips = r.fork(`bark${h}`);
    const loss = (facing: V3): number => (facing[1] < -0.35 ? 0 : clamp(0.08 + 0.55 * ((facing[1] + 0.35) / 1.35) + 0.24 * (strips.next() - 0.5), 0.04, 0.85));
    // It peels in strips along the grain, one segment wide and of uneven lengths, their ends staggered.
    const rowsOf = (): number[] => {
      const cuts = [0];
      for (let at = 1 + Math.floor(strips.next() * 3); at < count - 1; at += 3 + Math.floor(strips.next() * 4)) cuts.push(at);
      return [...cuts, count - 1];
    };
    const ragged = (q: V3): number => 0.07 * fbm3(q[0] * 3.1, q[1] * 3.1, q[2] * 3.1, seed + 51 + h, 2);
    // Two or three long checks down each half, shifting a column now and then, shallow toward the ends.
    const checks = Array.from({ length: 2 + (strips.next() < 0.5 ? 1 : 0) }, () => ({ col: 3 + Math.floor(strips.next() * (half * 2 - 6)), phase: strips.next() * 6 }));
    const check = (i: number, j: number): number => {
      const fade = clamp(Math.min(i, count - 1 - i) / 2, 0.3, 1);
      return checks.reduce((most, c) => {
        const at = c.col + Math.round(1.3 * Math.sin(i * 0.45 + c.phase));
        const off = Math.abs(j - at);
        return Math.max(most, fade * (off === 0 ? 1 : off === 1 ? 0.35 : 0));
      }, 0);
    };
    emitHalf(bark, wood, stem, h, carry, { cols: 1, rowsOf, loss, ragged, check }, ends);
  });

  // Stubs of boughs toward the crown end, which break off one by one as vitality falls.
  for (let s = 0; s < Math.round(p.boughs); s++) emitStub(bark, wood, stem, r.fork(`stub${s}`), carries);
  const anchors: Anchor[] = [];
  stations.forEach((st, i) => {
    if (i % 2 === 1) anchors.push({ position: ringPoint(st, Math.PI / 2, 1), normal: UP, size: clamp(girth * 2, 0, 1) });
  });
  return { parts: [bark.part(), wood.part()], anchors };
}

/** A short broken bough leaving the log's upper side, leaning toward its crown end, with pale wood where it snapped. */
function emitStub(bark: PartBuilder, wood: PartBuilder, stem: Stem, r: Rand, carries: readonly Carry[]): void {
  const st = stem.stations;
  const i = Math.round(r.range(0.35, 0.9) * (st.length - 1));
  const at = st[i] as Station;
  const theta = Math.PI / 2 + (r.next() < 0.5 ? -1 : 1) * r.range(0.4, 1.3);
  const h = Math.sin(theta - stem.split) >= 0 ? 0 : 1;
  const out = around(at, theta);
  const rad = at.radius(theta);
  const base = ringPoint(at, theta, 0.6);
  const dir = normalize(addScaled(out, at.d, r.range(0.5, 1.1)));
  const r0 = rad * r.range(0.2, 0.32);
  const len = rad * r.range(0.8, 1.5) + r0;
  const ch: Channels = { ...(carries[h] as Carry)(i, 0), loss: 0.1 + 0.7 * r.next(), pivot: base };
  const { u, v } = frame(dir, at.d);
  const radial = 6;
  const ringAt = (f: number): V3[] =>
    Array.from({ length: radial + 1 }, (_, j) => {
      const a = (j / radial) * Math.PI * 2;
      const jag = f === 1 ? r0 * 0.5 * Math.abs(fbm3(Math.cos(a) * 2, Math.sin(a) * 2, 0, stem.seed + i, 1)) : 0;
      return addScaled(addScaled(base, dir, len * f + jag), add(scale(u, Math.cos(a)), scale(v, Math.sin(a))), r0 * (1 - 0.35 * f));
    });
  const rows = [0, 0.5, 1].map(ringAt);
  emitGrid(bark, rows, (k, j) => ({ shade: barkAt(stem.roughness, stem.seed, 4, base, (j / radial) * Math.PI * 2, k, 1).shade * 0.95 }), () => ch);
  const tip = rows[2] as V3[];
  const center = addScaled(base, dir, len + r0 * 0.25);
  emitGrid(wood, [tip, tip.map(() => center)], () => ({ shade: 0.7 }), () => ({ ...ch, wither: 0.85 }));
}

// ---------- stump ----------

export function buildStump(p: Resolved<typeof stumpParams>, ctx: BuildContext): Built {
  const bark = new PartBuilder("bark", "solid");
  const wood = new PartBuilder("wood");
  const r = ctx.rand.fork("stump");
  const k = sizeOf(ctx);
  const girth = 0.3 * k * r.range(0.9, 1.1);
  const height = Math.max(girth * 0.8, p.height * k);
  const seed = Math.floor(r.next() * 1e6);
  // The trees' flare, kept low, with a root running out from each of its lobes.
  const lobes = lobesOf(r.fork("lobes"));
  const flare = flareOf(girth, lobes, 0.2 + 0.2 * p.roots, 0.55);
  const d = normalize([r.range(-0.05, 0.05), 1, r.range(-0.05, 0.05)]);
  const turn = r.next() * Math.PI * 2;
  const { u, v } = frame(d, [Math.cos(turn), 0, Math.sin(turn)]);
  const hollow = Math.min(height * 0.55, girth * 0.9);
  // The trees' flare rings below the hollow, a ring where the hollow bottoms out, and the top.
  const heights = [0, ...flare.rings.filter((y) => y < height - hollow - girth * 0.05), height - hollow, height];
  const tilt = r.range(0.02, 0.08);
  const tiltAt = r.next() * Math.PI * 2;
  const broken = brokenEnd(girth, seed, r.next() * Math.PI * 2, clamp((height / girth) * 0.45, 0.35, 1));
  const stations: Station[] = heights.map((y) => {
    const isTop = y === height;
    const radius = (theta: number): number => girth * (1 - 0.06 * (y / height)) * flare.at(y, theta);
    const end = !isTop ? () => 0 : p.top === "sawn" ? (theta: number, s: number) => radius(theta) * s * tilt * Math.cos(theta - tiltAt) : broken;
    const pith = isTop && p.top === "sawn" ? addScaled(scale(u, Math.cos(tiltAt) * girth * 0.08), v, Math.sin(tiltAt) * girth * 0.08) : undefined;
    return { c: scale(d, y), d, u, v, along: y, radius, end, wood: woodOf(p.bark), ...(pith === undefined ? {} : { pith }) };
  });
  const stem: Stem = { stations, roughness: p.bark, seed, furrows: 7, half: 12, split: 0 };
  const last = stations.length - 1;
  const crown = stations[last] as Station;
  // The hollow under the top: a soft bowl of dark rotten wood hanging from the wood's edge, as deep as `hollow` at its center.
  const share = woodOf(p.bark);
  const bowl = (theta: number, s: number): V3 => addScaled(capPoint(crown, theta, s), d, -hollow * Math.pow(Math.max(0, 1 - (s / share) ** 2), 0.6));
  const inHollow = (i: number, s: number): boolean => i === last && s < share;
  const rotten = new PartBuilder("bark");
  const halves = [v, scale(v, -1)].map((n, h) => sagging([0, -girth * 0.05, 0], n, girth * 1.2, SAG.stump[h] as number, 0.6));
  halves.forEach((held, h) => {
    const carry: Carry = () => held;
    // The top crumbles from its center outward, and a little of its rim never goes.
    const crumbs = r.fork(`top${h}`);
    // Each ring goes around the half in a slow wave, so neighboring pieces go close together and the edge stays soft.
    const wave = (col: number, band: number): number => 0.1 * Math.sin(col * 0.7 + band * 1.9 + h * 3 + seed) + 0.03 * (crumbs.next() - 0.5);
    const crumble = (band: number, col: number): number =>
      band === 0 ? (Math.sin(col * 0.9 + h * 2 + seed) < -0.2 ? 0 : 0.15 + wave(col, band)) : band === 1 ? 0.4 + wave(col, band) : 0.62 + wave(col, band);
    emitHalf(bark, wood, stem, h, carry, null, [{ i: last, facing: 1, look: p.top, crumble, hollow: bowl }], inHollow);
    const angles = halfAngles(stem, h);
    const shares = [1, 0.8, 0.6, 0.4, 0.2, 0].map((f) => f * share);
    emitGrid(rotten, shares.map((s) => angles.map((theta) => bowl(theta, s))), (i, j) => ({
      shade: 0.1 + 0.12 * (shares[i] as number) + 0.06 * fbm3(Math.cos(angles[j] as number) * 3, Math.sin(angles[j] as number) * 3, i, seed + 71, 1), tint: 0.02,
    }), () => ({ ...held, wither: 0.9 }));
  });
  for (const lobe of lobes) emitRoot(bark, stem, lobe, girth, girth * Math.max(0.3, (p.roots - 0.2) * 1.5), halves[Math.sin(lobe.angle - stem.split) >= 0 ? 0 : 1] as Channels);
  const anchors: Anchor[] = [{ position: capPoint(crown, 0, 0), normal: d, size: clamp(girth * 2, 0, 1) }];
  // The hollow uses the bark swatch, so it darkens as bark does. It has no collision, so nobody stands on it and moss skips it.
  return { parts: [bark.part(), wood.part(), rotten.part()], anchors };
}

/**
 * A root from one of the stump's lobes. It leaves the trunk inside its flare,
 * runs out `reach` past it half buried, thinning as it goes, and dives into
 * the soil over its last 40%. A smaller root forks from it.
 */
function emitRoot(bark: PartBuilder, stem: Stem, lobe: { readonly angle: number; readonly strength: number }, girth: number, reach: number, ch: Channels, fork = true): void {
  const base = stem.stations[0] as Station;
  const out = around(base, lobe.angle);
  const side = cross(UP, out);
  const rise = girth * 0.55 * lobe.strength;
  const span = girth * 0.5 + reach + base.radius(lobe.angle) * 0.5;
  const seed = stem.seed + Math.round(lobe.angle * 1000);
  const n = (t: number, k: number): number => fbm3(t * 3.1, k, lobe.angle * 2.3, seed, 2);
  const r0 = girth * 0.48 * lobe.strength;
  const path = Array.from({ length: 11 }, (_, k) => k / 10).map((t): { c: V3; r: number } => {
    const r = r0 * Math.pow(1 - 0.8 * t, 1.2) * (1 + 0.18 * n(t, 1));
    // It never dips under and rises again. Knuckles only lift it, and it dives once, from 60% of its length.
    const y = rise * Math.pow(1 - t, 1.4) + 0.2 * r + 0.15 * r * Math.abs(n(t, 2)) - girth * 0.9 * Math.pow(clamp((t - 0.6) / 0.4, 0, 1), 1.3);
    return { c: addScaled(addScaled([base.c[0], y, base.c[2]], out, girth * 0.5 + span * t), side, 0.22 * span * n(t, 3) * t), r };
  });
  const radial = 8;
  let u: V3 = UP;
  const rows: V3[][] = [];
  const normals: V3[][] = [];
  const shades: number[][] = [];
  path.forEach((at, k) => {
    const d = normalize(sub((path[Math.min(k + 1, path.length - 1)] as { c: V3 }).c, (path[Math.max(k - 1, 0)] as { c: V3 }).c));
    u = normalize(addScaled(u, d, -(u[0] * d[0] + u[1] * d[1] + u[2] * d[2])));
    const v = cross(d, u);
    const ring = Array.from({ length: radial + 1 }, (_, j) => (j / radial) * Math.PI * 2);
    normals.push(ring.map((a) => add(scale(u, Math.cos(a)), scale(v, Math.sin(a)))));
    const looks = ring.map((a) => barkAt(stem.roughness, stem.seed, 4, at.c, a, k * 0.3, at.c[1]));
    rows.push(ring.map((a, j) => addScaled(at.c, normals[k]?.[j] as V3, at.r * (1 + (looks[j]?.bump ?? 0)))));
    shades.push(looks.map((l) => l.shade));
  });
  emitGrid(bark, rows, (i, j) => ({ shade: shades[i]?.[j] ?? 0.5 }), () => ch, normals);
  if (fork && reach > girth * 0.6) {
    // A smaller root forks off part way out and runs off to one side.
    const at = path[3] as { c: V3; r: number };
    const turn = lobe.angle + (n(0.3, 4) > 0 ? 0.6 : -0.6);
    const sub0 = { angle: turn, strength: lobe.strength * 0.55 };
    const back = around(base, turn);
    const shifted: Stem = { ...stem, stations: [{ ...base, c: [at.c[0] - back[0] * girth * 0.5, 0, at.c[2] - back[2] * girth * 0.5] as V3, radius: () => girth * 0.4 }] };
    emitRoot(bark, shifted, sub0, girth, reach * 0.5, ch, false);
  }
}
