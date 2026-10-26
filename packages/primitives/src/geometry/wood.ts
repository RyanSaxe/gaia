// Wood lying still in the grass: a fallen log and an old stump. Their bark
// is the trees' own (`barkAt`) and a stump flares into the trees' root lobes
// (`flareOf`), so both read as come down from a tree of this world. A sawn
// face shows its rings around a lighter heartwood; a broken one, splinters.
//
// Each body is two halves split down its middle that meet exactly while
// healthy. As vitality falls each half sags (`droop`) about a line on the
// ground beyond the other half, so the two lean apart and settle into the
// turf. A log's bark is laid in plates that drop away (`loss`) to the grey
// wood under it, and its stubs break off; a stump's top crumbles from its
// heart into a dark hollow. These are the channels every renderer draws,
// instanced copies included.

import type { Anchor, BuildContext, Built, Rand, Resolved } from "@gaia/schema";
import type { fallenLogParams, stumpParams } from "../rock.ts";
import { barkAt, flareOf, lobesOf } from "./foliage.ts";
import { type Channels, PartBuilder, type V3, add, addScaled, clamp, cross, fbm3, normalize, scale, sub } from "./kit.ts";

const UP: V3 = [0, 1, 0];
/** Where the bark ends and the wood begins, in the stem's radii: just inside its deepest furrow, so rough bark lies thick and smooth bark thin. */
const woodOf = (roughness: number): number => 0.97 - 0.13 * roughness;

/** One ring of a stem: its center, axis and frame (`v` is `d × u`), its smooth radius, and how far a cut or broken end stands past it. */
interface Station {
  readonly c: V3;
  readonly d: V3;
  readonly u: V3;
  readonly v: V3;
  readonly along: number;
  readonly radius: (theta: number) => number;
  /** Along `d`, at `theta` and share `s` of the radius; zero except at an end. */
  readonly end: (theta: number, s: number) => number;
  /** Where a sawn face's pith sits off the center; its rings close on it. */
  readonly pith?: V3;
  /** Where its bark ends and its wood begins, as a share of its radius (`woodOf`). */
  readonly wood: number;
}

interface Stem {
  readonly stations: readonly Station[];
  readonly roughness: number;
  readonly seed: number;
  readonly furrows: number;
  /** Segments around each half. */
  readonly half: number;
  /** One half spans `split` to `split + π` around the axis; the other, the rest. */
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
  return { q: ringPoint(st, theta, 1 + bump), shade };
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

/** What carries each row of a grid as it declines. */
type Carry = (row: number) => Channels;

/** A grid of rows of points, its front facing (along a row) × (down the rows). */
function emitGrid(out: PartBuilder, rows: readonly (readonly V3[])[], look: (i: number, j: number) => Look, carry: Carry, normals = faceNormals(rows)): void {
  const cols = rows[0]?.length ?? 0;
  const first = out.vertexCount;
  rows.forEach((row, i) => row.forEach((p, j) => {
    const l = look(i, j);
    out.vertex(p, normals[i]?.[j] ?? UP, l.shade, { ...carry(i), tint: l.tint ?? 0 });
  }));
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const a = first + i * cols + j;
      out.triangle(a, a + 1, a + cols);
      out.triangle(a + 1, a + cols + 1, a + cols);
    }
  }
}

/**
 * Cuts a grid into plates that meet edge to edge: columns at `colCuts`, and
 * each column's rows at its own cuts, so the plates break joint. Each drops
 * away to its own middle below the vitality `lossOf` gives it, from its row
 * band and the way its middle faces. A plate with a `backing` has a dark
 * inner face there, drawn into the backing's builder, so once its neighbors
 * have gone no one sees through its inside, which is drawn front-faced only.
 */
function emitPlates(
  out: PartBuilder, rows: readonly (readonly V3[])[], normals: readonly (readonly V3[])[], look: (i: number, j: number) => Look, carry: Carry,
  rowCutsOf: (col: number) => readonly number[], colCuts: readonly number[], lossOf: (band: number, facing: V3) => number,
  backing?: { readonly out: PartBuilder; readonly rows: readonly (readonly V3[])[] },
): void {
  for (let b = 0; b + 1 < colCuts.length; b++) {
    const rowCuts = rowCutsOf(b);
    for (let a = 0; a + 1 < rowCuts.length; a++) {
      const [i0, i1, j0, j1] = [rowCuts[a], rowCuts[a + 1], colCuts[b], colCuts[b + 1]] as [number, number, number, number];
      if (i1 <= i0) continue;
      const pick = <T>(grid: readonly (readonly T[])[]): T[][] => grid.slice(i0, i1 + 1).map((row) => row.slice(j0, j1 + 1));
      const [mi, mj] = [Math.round((i0 + i1) / 2), Math.round((j0 + j1) / 2)];
      const loss = lossOf(a, normals[mi]?.[mj] ?? UP);
      const middle = rows[mi]?.[mj] as V3;
      const held = (i: number): Channels => ({ ...carry(i0 + i), loss, pivot: middle });
      emitGrid(out, pick(rows), (i, j) => look(i0 + i, j0 + j), held, pick(normals));
      if (backing !== undefined) emitGrid(backing.out, pick(backing.rows).map((row) => row.reverse()), () => ({ shade: 0.08, tint: 0.02 }), held);
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

/** A broken face's rings, from the wood's edge to the heart. */
const brokenRings = (wood: number): number[] => [wood, 0.62, 0.38, 0.17, 0];

/** How a broken end splinters past its ring: a tongue of long splinters on one side, ragged everywhere, closing to one point at the heart. */
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

/** A capped station: which way its face looks along the stem, sawn or broken, and, for a face that crumbles, when each of its plates goes, by band from the rim (0) to the heart (2). */
interface Cap {
  readonly i: number;
  readonly facing: 1 | -1;
  readonly look: End;
  readonly crumble?: (band: number) => number;
}

/** How one half's bark sheds: plates so many segments around, each column's cuts along the stem, and when a plate facing so drops away. */
interface Shed {
  readonly cols: number;
  readonly rowsOf: (col: number) => readonly number[];
  readonly loss: (facing: V3) => number;
}

/**
 * One half of a stem: its bark, the grey wood under bark that sheds, the
 * face of its split, and its end faces. `hollow` says where the split's face
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
  // Old bark is mottled where lichen and damp have been at it.
  const mottle = (i: number, j: number): number => fbm3((st[i] as Station).along * 1.1, Math.cos(thetas[j] as number) * 1.4, Math.sin(thetas[j] as number) * 1.4, stem.seed + 41, 2);
  const barkLook = (i: number, j: number): Look => ({ shade: (rows[i]?.[j]?.shade ?? 0.5) + 0.08 * mottle(i, j), tint: 0.015 * mottle(i, j) });
  if (shed === null) emitGrid(bark, points, barkLook, carry, normals);
  else {
    // The inner face lies just under the outer, so a plate seen from inside reads as dark inner bark however it is seen.
    // It is drawn as wood, so moss grows only on bark's outer face.
    const inner = points.map((row, i) => row.map((q, j) => addScaled(q, around(st[i] as Station, thetas[j] as number), -0.02 * (st[i] as Station).radius(thetas[j] as number))));
    emitPlates(bark, points, normals, barkLook, carry, shed.rowsOf, cutsOf(stem.half, shed.cols), (_band, facing) => shed.loss(facing), { out: wood, rows: inner });
    // The wood under the bark, weathered and checked along its grain: dark cracks that wander down the stem,
    // on twice the bark's segments so a crack is a crease rather than a band.
    const fine = Array.from({ length: stem.half * 2 + 1 }, (_, j) => stem.split + h * Math.PI + (j * Math.PI) / (stem.half * 2));
    const check = (i: number, theta: number): number =>
      clamp(1 - 3 * Math.abs(fbm3(Math.cos(theta) * 1.6, Math.sin(theta) * 1.6, (st[i] as Station).along * 0.3, stem.seed + 31, 2)), 0, 1);
    emitGrid(wood, st.map((s, i) => fine.map((theta) => ringPoint(s, theta, s.wood * (1 - 0.06 * check(i, theta))))), (i, j) => ({
      shade: 0.4 + 0.14 * fbm3((st[i] as Station).along * 0.9, (fine[j] as number) * 3.1, 0, stem.seed + 11, 2) - 0.34 * check(i, fine[j] as number), tint: -0.01,
    }), (i) => ({ ...carry(i), wither: 0.95 }));
  }

  const capOf = (i: number): Cap | undefined => ends.find((e) => e.i === i);
  for (const e of ends) {
    const at = st[e.i] as Station;
    const angles = halfAngles(stem, h, e.facing < 0);
    const rings = e.look === "sawn" ? sawnRings(at.radius(0), at.wood) : brokenRings(at.wood).map((s) => ({ s, shade: 0, tint: -0.005 }));
    // A band of bark from its ragged edge to the wood, then the face ring by ring to the heart.
    const rim = angles.map((theta) => barkPoint(stem, e.i, theta).q);
    const jitter = (theta: number, s: number, k: number): number =>
      e.look === "sawn" && s < at.wood && s > 0 ? s * (1 + 0.03 * fbm3(Math.cos(theta) * 1.5, Math.sin(theta) * 1.5, k * 0.7, stem.seed + 5, 2)) : s;
    const face = rings.map((ring, k) => angles.map((theta) => capPoint(at, theta, jitter(theta, ring.s, k))));
    const held = (): Channels => carry(e.i);
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
      // Bands from the rim to the heart, four plates around the half, their edges staggered a ring or two.
      const bandOf = [0.6, 0.3].map((s) => rings.findIndex((ring) => ring.s < s));
      const stagger = rings.length > 8 ? 2 : 0;
      const crumble = e.crumble;
      const rowsOf = (col: number): number[] => [0, ...bandOf.map((at, k) => clamp(at + (((col + k) % 3) - 1) * stagger, 1, rings.length - 2)), rings.length - 1];
      emitPlates(wood, face, faceNormals(face), look, cut, rowsOf, cutsOf(stem.half, Math.ceil(stem.half / 4)), (band) => crumble(band));
    }
  }

  // The split's face, across the stem from one edge of the half to the other; it shows only once the halves part.
  // A broken end's face is ragged, so the split's face meets it at every one of its rings. Where bark sheds, the
  // face stops at the wood, so no edge of it stands up like a fin once the bark has gone.
  const share = (st[0] as Station).wood;
  const columns = ends.some((e) => e.look === "broken") ? brokenRings(share) : [share, 0.5, 0];
  const edge = shed === null ? [1] : [];
  const shareOf = [...edge, ...columns, ...columns.slice().reverse().slice(1), ...edge];
  const [near, far] = [thetas[thetas.length - 1] as number, thetas[0] as number];
  const across = (i: number): V3[] => {
    const station = st[i] as Station;
    const point = capOf(i) === undefined ? ringPoint : capPoint;
    const side = (theta: number): V3[] => [...(shed === null ? [barkPoint(stem, i, theta).q] : []), ...columns.map((s) => point(station, theta, s))];
    return [...side(near), ...side(far).reverse().slice(1)];
  };
  emitGrid(wood, st.map((_, i) => across(i)), (i, j) => {
    const s = shareOf[j] ?? 1;
    const streak = fbm3((st[i] as Station).along * 0.7, j * 0.9, h * 5, stem.seed + 9, 2);
    return { shade: s >= 1 ? 0.2 : hollow(i, s) ? 0.12 : 0.58 + 0.12 * streak, tint: -0.005 };
  }, (i) => ({ ...carry(i), wither: 0.85 }));
}

/** A stem's frame on axis `d`, with `u` as near `toward` as the axis allows. */
function frame(d: V3, toward: V3): { u: V3; v: V3 } {
  const u = normalize(addScaled(toward, d, -(toward[0] * d[0] + toward[1] * d[1] + toward[2] * d[2])));
  return { u, v: cross(d, u) };
}

const sizeOf = (ctx: BuildContext): number => 0.75 + 0.25 * (ctx.facts.scale ?? 1);

/**
 * A half that sags as it fails about a line on the ground beyond the other
 * half, `reach` across from its own side `n` under `at`: it settles into the
 * turf, and its top leans out from the split.
 */
const sagging = (at: V3, n: V3, reach: number, droop: number, wither: number): Channels => {
  const bough: V3 = [at[0] - n[0] * reach, at[1], at[2] - n[2] * reach];
  return { loss: 0, droop, wither, glow: 0, pivot: bough, bough };
};

/** How far each half sags at vitality 0: one further than the other, so they part unevenly. */
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
  const bend = r.range(-0.05, 0.05) * length;
  const count = clamp(Math.round(length / (girth * 1.1)) + 1, 6, 16);
  const radiusAt = (t: number): number => girth * (1.08 - 0.2 * t) * (1 + 0.08 * fbm3(t * 2.2, 0, 0, seed, 2));
  const centerAt = (t: number): V3 => [(t - 0.5) * length, radiusAt(t) * 0.76, bend * Math.sin(Math.PI * t)];
  const looks: Record<typeof p.ends, readonly [End, End]> = { sawn: ["sawn", "sawn"], broken: ["broken", "broken"], "one of each": ["sawn", "broken"] };
  const [butt, crown] = looks[p.ends];
  const tilt = r.range(-0.07, 0.07);
  const tiltAt = r.next() * Math.PI * 2;
  const stations: Station[] = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const d = normalize(sub(centerAt(Math.min(1, t + 0.02)), centerAt(Math.max(0, t - 0.02))));
    const { u, v } = frame(d, cross(UP, d));
    const rad = radiusAt(t);
    // A lying log settles a little flatter than round, with burls along it.
    const radius = (theta: number): number => rad * (1 + 0.04 * Math.cos(2 * theta) + 0.05 * fbm3(t * length * 1.3, Math.cos(theta) * 1.2, Math.sin(theta) * 1.2, seed + 21, 2));
    const look = i === 0 ? butt : i === count - 1 ? crown : undefined;
    const facing = i === 0 ? -1 : 1;
    const broken = brokenEnd(rad, seed + i, r.next() * Math.PI * 2, 0.8);
    const end = look === undefined ? () => 0 : look === "sawn" ? (theta: number, s: number) => facing * radius(theta) * s * tilt * Math.cos(theta - tiltAt) : (theta: number, s: number) => facing * broken(theta, s);
    const pith = look === "sawn" ? addScaled(scale(u, Math.cos(tiltAt) * rad * 0.07), v, Math.sin(tiltAt) * rad * 0.07) : undefined;
    return { c: centerAt(t), d, u, v, along: t * length, radius, end, wood: woodOf(p.bark), ...(pith === undefined ? {} : { pith }) };
  });
  const stem: Stem = { stations, roughness: p.bark, seed, furrows: 7, half: 8, split: -Math.PI / 2 };
  // Each half sags about a line along the ground beyond the other half, so it sinks as it parts.
  const reach = girth * 3.2;
  const carries: Carry[] = [1, -1].map((side, h) => (i) => {
    const st = stations[i] as Station;
    return sagging([st.c[0], 0, st.c[2]], scale(st.u, side), reach, SAG.log[h] as number, 0.7);
  });
  const ends = [{ i: 0, facing: -1 as const, look: butt }, { i: count - 1, facing: 1 as const, look: crown }];
  carries.forEach((carry, h) => {
    // Bark weathers off the top first and holds on low down where it lies damp; the lowest never goes.
    const plates = r.fork(`bark${h}`);
    const loss = (facing: V3): number => (facing[1] < -0.35 ? 0 : clamp(0.08 + 0.55 * ((facing[1] + 0.35) / 1.35) + 0.24 * (plates.next() - 0.5), 0.04, 0.85));
    // Plates two segments around and two or three stations long, each column's joints offset from its neighbors'.
    const rowsOf = (col: number): number[] => {
      const cuts = [0];
      for (let at = col % 2 === 0 ? 2 : 1; at < count - 1; at += 2 + (plates.next() < 0.4 ? 1 : 0)) cuts.push(at);
      return [...cuts, count - 1];
    };
    emitHalf(bark, wood, stem, h, carry, { cols: 2, rowsOf, loss }, ends);
  });

  // Stubs of boughs toward the crown end, breaking off one by one.
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
  const ch: Channels = { ...(carries[h] as Carry)(i), loss: 0.1 + 0.7 * r.next(), pivot: base };
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
  const CUP = 0.8;
  const inHollow = (i: number, s: number): boolean => i >= last - 1 && s < CUP;
  const halves = [v, scale(v, -1)].map((n, h) => sagging([0, -girth * 0.05, 0], n, girth * 1.2, SAG.stump[h] as number, 0.6));
  halves.forEach((held, h) => {
    const carry: Carry = () => held;
    // The top crumbles from its heart outward; a little of its rim never goes.
    const crumbs = r.fork(`top${h}`);
    const crumble = (band: number): number => (band === 0 ? (crumbs.next() < 0.4 ? 0 : 0.05 + 0.2 * crumbs.next()) : band === 1 ? 0.3 + 0.2 * crumbs.next() : 0.55 + 0.2 * crumbs.next());
    emitHalf(bark, wood, stem, h, carry, null, [{ i: last, facing: 1, look: p.top, crumble }], inHollow);
    // The dark hollow under the top: its wall and its floor.
    const angles = halfAngles(stem, h);
    const floor = (theta: number, s: number): V3 => addScaled(addScaled(crown.c, around(crown, theta), crown.radius(theta) * s), d, -hollow);
    const rotten = (): Channels => ({ ...held, wither: 0.95 });
    emitGrid(wood, [angles.map((theta) => capPoint(crown, theta, CUP)), angles.map((theta) => floor(theta, CUP))], () => ({ shade: 0.16, tint: 0.01 }), rotten);
    emitGrid(wood, [CUP, 0.4, 0].map((s) => angles.map((theta) => floor(theta, s))), () => ({ shade: 0.08, tint: 0.01 }), rotten);
  });
  for (const lobe of lobes) emitRoot(bark, stem, lobe, girth, girth * Math.max(0.3, (p.roots - 0.2) * 1.5), halves[Math.sin(lobe.angle - stem.split) >= 0 ? 0 : 1] as Channels);
  const anchors: Anchor[] = [{ position: capPoint(crown, 0, 0), normal: d, size: clamp(girth * 2, 0, 1) }];
  return { parts: [bark.part(), wood.part()], anchors };
}

/**
 * A root from one of the stump's lobes: it leaves the trunk inside its flare,
 * runs out `reach` past it half buried, and dives into the ground.
 */
function emitRoot(bark: PartBuilder, stem: Stem, lobe: { readonly angle: number; readonly strength: number }, girth: number, reach: number, ch: Channels): void {
  const base = stem.stations[0] as Station;
  const out = around(base, lobe.angle);
  const side = cross(UP, out);
  const rise = girth * 0.6 * lobe.strength;
  const span = girth * 0.5 + reach + base.radius(lobe.angle) * 0.5;
  const wander = Math.sin(lobe.angle * 7.3 + stem.seed) * 0.18 * span;
  // Highest where it leaves the trunk, it humps along half buried and sinks away into the soil, never ending in a point above it.
  const path = [0, 0.16, 0.32, 0.5, 0.68, 0.84, 1].map((t): { c: V3; r: number } => ({
    c: addScaled(addScaled([0, rise * Math.pow(1 - t, 1.3) - girth * 0.55 * t * t, 0], out, girth * 0.5 + span * t), side, wander * Math.sin(Math.PI * t * 0.9)),
    r: girth * 0.5 * lobe.strength * (1 - 0.65 * Math.pow(t, 1.5)),
  }));
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
}
