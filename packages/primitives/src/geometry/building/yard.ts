// Features that stand in the yard on the house's free side, each saying
// what its entity does for the rest of the code: a dovecote whose doves
// carry messages, a well the others draw from, a bell that signals, a forge
// that makes tools and a granary that keeps what was made. Each declines
// through its channels as the code fails: doves fly home, the well's water
// sinks, the bell hangs askew, the forge goes cold and the granary slumps
// off its stones. Nothing is rebuilt.

import type { BuildContext, BuildingPlan, Built, Mass, Rand, Resolved } from "@gaia/schema";
import type { bellParams, dovecoteParams, forgeParams, granaryParams, wellParams } from "../../structure.ts";
import { type Channels, PartBuilder, type V3, add, addScaled, clamp, cross, fbm3, lerp, lossThreshold, normalize, scale, sub } from "../kit.ts";
import { UP, beam, box, log, quad, tri } from "../blocks.ts";
import { ruinOf, still } from "./frame.ts";
import { featureSide } from "./features.ts";
import { smoke } from "./roofs.ts";
import { ivy, lump, weeds } from "./ruin.ts";

const TAU = Math.PI * 2;

/**
 * A feature's own frame in the yard beside the house's free side: `x` out
 * from the house, `z` along it toward the front, `y` up from the yard.
 */
interface Yard {
  /** A point in the house's frame. */
  at(x: number, y: number, z: number): V3;
  /** A direction in the house's frame. */
  dir(x: number, y: number, z: number): V3;
  /** Its axes in the house's frame: out, up and along. */
  readonly axes: readonly [V3, V3, V3];
}

/** The frame of a feature whose middle stands `x` out from the house's free side and `z` along it. */
function yard(plan: BuildingPlan, x: number, z: number): Yard {
  const side = featureSide(plan);
  const x0 = side * (plan.width / 2 + x);
  return { at: (dx, y, dz) => [x0 + side * dx, y, z + dz], dir: (dx, dy, dz) => [side * dx, dy, dz], axes: [[side, 0, 0], UP, [0, 0, 1]] };
}

/** The same place with `x` and `z` swapped: `x` along the house and `z` out from it, so a feature can face the front. */
const turned = (Y: Yard): Yard => ({ at: (x, y, z) => Y.at(z, y, x), dir: (x, y, z) => Y.dir(z, y, x), axes: [Y.axes[2], UP, Y.axes[0]] });

/** A triangle facing away from `inside`, however the frame is mirrored. */
function facet(b: PartBuilder, a: V3, c: V3, d: V3, shade: number, ch: Channels, inside: V3): void {
  const n = normalize(cross(sub(c, a), sub(d, a)));
  const mid: V3 = [(a[0] + c[0] + d[0]) / 3 - inside[0], (a[1] + c[1] + d[1]) / 3 - inside[1], (a[2] + c[2] + d[2]) / 3 - inside[2]];
  tri(b, [a, c, d], n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0 ? scale(n, -1) : n, shade, ch);
}

/**
 * A roof plane from its eave (`e0` to `e1`) up to its top edge (`t1` to
 * `t0`, one point for a hip's triangle), laid in `rows` courses that each lap
 * over the one below, facing `out`.
 */
function slope(b: PartBuilder, e0: V3, e1: V3, t1: V3, t0: V3, rows: number, out: V3, ch: (q: V3) => Channels, r: Rand): void {
  let n = normalize(cross(sub(e1, e0), sub(t0, e0)));
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = scale(n, -1);
  const lip = scale(n, 0.035);
  for (let j = 0; j < rows; j++) {
    const p0 = add(lerp(e0, t0, j / rows), lip);
    const p1 = add(lerp(e1, t1, j / rows), lip);
    const q0 = lerp(e0, t0, (j + 1) / rows);
    const q1 = lerp(e1, t1, (j + 1) / rows);
    const shade = 0.48 + 0.06 * (j % 2) + 0.05 * r.next();
    const c = ch(lerp(lerp(p0, p1, 0.5), lerp(q0, q1, 0.5), 0.5));
    if (Math.hypot(q0[0] - q1[0], q0[1] - q1[1], q0[2] - q1[2]) < 1e-4) tri(b, [p0, p1, q0], n, shade, c);
    else quad(b, [p0, p1, q1, q0], n, [shade, shade, shade + 0.08, shade + 0.08], c);
  }
}

/** Tufts of rank grass in a ring about a feature's foot, which grow in as the code fails. */
function weedsAbout(b: PartBuilder, Y: Yard, inner: number, outer: number, count: number, r: Rand): void {
  const spots = Array.from({ length: count }, () => {
    const a = r.next() * TAU;
    const d = inner + (outer - inner) * r.next();
    const p = Y.at(Math.cos(a) * d, 0, Math.sin(a) * d);
    return { x: p[0], z: p[2], grow: 0.18 + 0.32 * r.next(), size: 0.4 + 0.35 * r.next() };
  });
  weeds(b, spots, r.fork("tufts"));
}

/** A round mass standing for a feature's walls, so ivy climbs them as it climbs the house's. */
const roundPlan = (Y: Yard, radius: number, height: number): BuildingPlan => {
  const c = Y.at(0, 0, 0);
  const m: Mass = { x: c[0], z: c[2], width: radius * 2, depth: radius * 2, round: true, wallHeight: height, storeys: 1, rise: 0, ridge: "x", roof: "cone", fall: 1, ends: [true, true] };
  return { width: radius * 2, depth: radius * 2, floor: 0, footing: 0.6, masses: [m], settle: 0, openings: [] };
};

// ---------- dovecote ----------

/** A dove a little over a foot long, its beak along `t` and its back toward `up`; `open` spreads its wings from folded (0) to gliding (1). */
function dove(b: PartBuilder, c: V3, t: V3, up: V3, open: number, ch: Channels): void {
  const s = 0.36;
  const right = normalize(cross(t, up));
  const nose = addScaled(addScaled(c, t, s * 0.52), up, s * 0.06);
  const tail = addScaled(addScaled(c, t, -s * 0.66), up, s * 0.03);
  const ring = [addScaled(c, up, s * 0.17), addScaled(c, right, s * 0.15), addScaled(c, up, -s * 0.13), addScaled(c, right, -s * 0.15)] as const;
  for (let k = 0; k < 4; k++) {
    const a = ring[k] as V3;
    const d = ring[(k + 1) % 4] as V3;
    facet(b, nose, a, d, 0.72, ch, c);
    facet(b, tail, d, a, 0.64, ch, c);
  }
  // A fanned tail, and the wings from the shoulders.
  const fan = addScaled(c, t, -s * 0.95);
  facet(b, tail, addScaled(fan, right, s * 0.16), addScaled(fan, right, -s * 0.16), 0.6, ch, addScaled(c, up, -1));
  for (const side of [-1, 1]) {
    const root0 = addScaled(addScaled(c, t, s * 0.2), right, side * s * 0.1);
    const root1 = addScaled(addScaled(c, t, -s * 0.22), right, side * s * 0.1);
    const tip = addScaled(addScaled(addScaled(c, right, side * s * (0.32 + 0.95 * open)), up, s * (0.08 + 0.2 * open)), t, -s * (0.3 + 0.12 * open));
    facet(b, root0, tip, root1, 0.8, ch, addScaled(c, up, -1));
  }
}

/** Doves circling high over a cote at `top`, each turning about its middle at its own pace; they fly home into `home` as the code fails. */
function circling(b: PartBuilder, Y: Yard, count: number, top: number, home: V3, r: Rand): void {
  const center = Y.at(0, 0, 0);
  for (let i = 0; i < count; i++) {
    const a = r.next() * TAU;
    const reach = 1.7 + 1.4 * r.next();
    const c = Y.at(Math.cos(a) * reach, top + 0.9 + 1.7 * r.next(), Math.sin(a) * reach);
    const dx = c[0] - center[0];
    const dz = c[2] - center[2];
    // A positive turn about up carries a point at (x, z) toward (z, -x); each dove flies that way, banked into the turn.
    const t = normalize([dz, 0, -dx]);
    const up = normalize(addScaled(UP, normalize([-dx, 0, -dz]), 0.35));
    dove(b, c, t, up, 1, { loss: lossThreshold(r.next(), 0.85, 0.45), droop: 0, wither: 0.5, glow: 0, pivot: home, tint: (r.next() - 0.5) * 0.03, spin: [0, 0.028 + 0.03 * r.next(), 0] });
  }
}

export function buildDovecote(p: Resolved<typeof dovecoteParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("dovecote");
  return p.cote === "a cote on a post" ? postCote(p.flock, r, plan) : roundCote(p.flock, r, plan);
}

/** Angles from `a0` to `a1` around a ring, less the gaps, as runs to lay stones in. */
function freeArcs(gaps: readonly (readonly [number, number])[], start: number): [number, number][] {
  const from = gaps[0]?.[1] ?? start;
  const norm = gaps.map(([g0, g1]): [number, number] => {
    const s = (((g0 - from) % TAU) + TAU) % TAU;
    return [s, s + (g1 - g0)];
  });
  norm.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [s, e] of norm) {
    if (s > at + 0.02) out.push([from + at, from + s]);
    at = Math.max(at, e);
  }
  if (TAU - at > 0.02) out.push([from + at, from + TAU]);
  return out;
}

function roundCote(flock: number, r: Rand, plan: BuildingPlan): Built {
  const R = 1.15;
  const H = 3.4;
  const Y = yard(plan, 1.0 + R, -plan.depth * 0.18);
  const stone = new PartBuilder("masonry", "solid");
  const mortar = new PartBuilder("wall", "solid");
  const wood = new PartBuilder("timber", "solid");
  const roof = new PartBuilder("roof", "solid");
  const moss = new PartBuilder("moss");
  const weed = new PartBuilder("leaf");
  const seed = Math.floor(r.next() * 1e6);
  const ring = (a: number, d: number, y: number): V3 => Y.at(Math.cos(a) * d, y, Math.sin(a) * d);
  const radial = (a: number): V3 => Y.dir(Math.cos(a), 0, Math.sin(a));
  const tangent = (a: number): V3 => Y.dir(-Math.sin(a), 0, Math.cos(a));

  // Rows of rough stones round a mortar core; the door faces out from the house and two rings of flight holes run under the eaves.
  const rows = 12;
  const rowH = (H + 0.6) / rows;
  const doorTop = -0.6 + rowH * Math.round(1.75 / rowH);
  const doorHalf = 0.34 / R;
  const holeHalf = 0.1 / R;
  const holes: { a: number; y: number }[] = [];
  for (const [shift, y] of [[0, H - 0.5], [0.5, H - 1.0]] as const) for (let k = 0; k < 7; k++) holes.push({ a: ((k + shift) / 7) * TAU + 0.22, y });
  for (let j = 0; j < rows; j++) {
    const y0 = -0.6 + j * rowH;
    const y1 = y0 + rowH;
    const gaps: [number, number][] = holes.filter((h) => y1 > h.y - 0.12 && y0 < h.y + 0.12).map((h) => [h.a - holeHalf, h.a + holeHalf]);
    if (y1 <= doorTop + 1e-6) gaps.unshift([-doorHalf, doorHalf]);
    for (const [a0, a1] of freeArcs(gaps, r.next() * TAU)) {
      const count = Math.max(1, Math.round(((a1 - a0) * R) / (0.44 + 0.12 * r.next())));
      for (let k = 0; k < count; k++) {
        const b0 = a0 + ((a1 - a0) * k) / count;
        const b1 = a0 + ((a1 - a0) * (k + 1)) / count;
        const am = (b0 + b1) / 2;
        const chord = 2 * R * Math.sin((b1 - b0) / 2);
        const c = ring(am, R - 0.1 + 0.025 * r.next(), (y0 + y1) / 2);
        box(stone, c, [tangent(am), UP, radial(am)], [chord / 2 - 0.014, rowH / 2 - 0.013, 0.1], 0.4 + 0.24 * r.next(), still(ring(am, R - 0.1, y0), 0.35 + 0.35 * r.next(), { tint: (r.next() - 0.5) * 0.05 }), { bottom: j > 0 });
      }
    }
  }
  // The mortar core behind the stones, rotting through from the top; the flight holes and the doorway show dark in it.
  const sides = 16;
  for (let j = 0; j < rows; j++) {
    const y0 = -0.6 + j * rowH;
    const y1 = y0 + rowH;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * TAU;
      const a1 = ((k + 1) / sides) * TAU;
      const am = (a0 + a1) / 2;
      // None across the doorway, which shows dark once the door swings open.
      if (y1 <= doorTop + 1e-6 && (a0 < doorHalf || a1 > TAU - doorHalf)) continue;
      const n = fbm3(Math.cos(am) * 2, y0 * 2, Math.sin(am) * 2, seed, 2);
      quad(mortar, [ring(a0, R - 0.06, y0), ring(a1, R - 0.06, y0), ring(a1, R - 0.06, y1), ring(a0, R - 0.06, y1)], radial(am), 0.42 + 0.08 * n, still(ring(am, R - 0.06, H / 2), 0.6, { rot: clamp(0.3 + 0.55 * (y1 / H) + 0.2 * n, 0, 1) }));
    }
  }
  for (const h of holes) {
    const dark = [ring(h.a - holeHalf, R - 0.03, h.y - 0.12), ring(h.a + holeHalf, R - 0.03, h.y - 0.12), ring(h.a + holeHalf, R - 0.03, h.y + 0.12), ring(h.a - holeHalf, R - 0.03, h.y + 0.12)] as const;
    quad(wood, dark, radial(h.a), 0, still(ring(h.a, R, h.y), 0.3));
    box(stone, ring(h.a, R + 0.04, h.y - 0.15), [tangent(h.a), UP, radial(h.a)], [0.13, 0.03, 0.11], 0.6, still(ring(h.a, R, h.y - 0.15), 0.4));
  }
  // A plank door, which swings open on its hinge as the cote is left.
  const hinge = ring(-doorHalf, R - 0.05, 0);
  const swing = 1.1 * featureSide(plan);
  for (let k = 0; k < 4; k++) {
    const a = -doorHalf + ((k + 0.5) / 4) * doorHalf * 2;
    box(wood, ring(a, R - 0.05, (doorTop - 0.02) / 2), [tangent(a), UP, radial(a)], [(doorHalf * R) / 4 - 0.006, (doorTop + 0.02) / 2, 0.03], 0.38 + 0.08 * r.next(), still(hinge, 0.6, { rot: 0.45, fall: [0, swing, 0, 0.36] }));
  }
  quad(wood, [ring(-doorHalf, R - 0.12, 0), ring(doorHalf, R - 0.12, 0), ring(doorHalf, R - 0.12, doorTop), ring(-doorHalf, R - 0.12, doorTop)], radial(0), 0, still(hinge, 0.3));
  // A ledge round its middle to keep rats from climbing, and a course under the eaves.
  for (const [y, out, tall, deep] of [[1.75, R + 0.03, 0.12, 0.22], [H - 0.04, R + 0.04, 0.14, 0.26]] as const) {
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * TAU;
      const a1 = ((k + 1) / sides) * TAU;
      beam(stone, ring(a0, out, y), ring(a1, out, y), tall, deep, UP, 0.58 + 0.06 * r.next(), still(ring((a0 + a1) / 2, R, y), 0.45));
    }
  }

  // A cone of courses that rots through and sags at its eaves, a lantern on
  // top that the doves fly in and out of, and a finial that leans and falls.
  const eave = R + 0.32;
  const neck = 0.36;
  const crown = H + 1.3;
  const apex = Y.at(0, crown, 0);
  const courses = 5;
  for (let j = 0; j < courses; j++) {
    const t0 = j / courses;
    const t1 = (j + 1) / courses;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * TAU;
      const a1 = ((k + 1) / sides) * TAU;
      const am = (a0 + a1) / 2;
      const n = normalize(addScaled(scale(radial(am), crown - H), UP, eave - neck));
      const at = (a: number, t: number, lip: number): V3 => addScaled(ring(a, eave + (neck - eave) * t, H + (crown - H) * t), n, lip);
      const noise = fbm3(Math.cos(am) * 1.6, t0 * 3, Math.sin(am) * 1.6, seed + 7, 2);
      const ch = { loss: 0, droop: 0.05, wither: 0.6, glow: 0, pivot: apex, rot: clamp(0.3 + 0.5 * (1 - t0) + 0.25 * noise, 0, 1) };
      quad(roof, [at(a0, t0, 0.035), at(a1, t0, 0.035), at(a1, t1, 0), at(a0, t1, 0)], n, [0.5, 0.5, 0.58, 0.58].map((s) => s + 0.05 * (j % 2)), ch);
    }
  }
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * TAU;
    const a1 = ((k + 1) / sides) * TAU;
    quad(roof, [ring(a0, eave, H), ring(a0, R, H), ring(a1, R, H), ring(a1, eave, H)], [0, -1, 0], 0.22, still(apex, 0.6));
  }
  const lantern = 0.52;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    beam(wood, ring(a, neck - 0.08, crown - 0.05), ring(a, neck - 0.08, crown + lantern), 0.08, 0.08, radial(a), 0.42, still(ring(a, neck, crown), 0.55));
  }
  const floorSides = 8;
  for (let k = 0; k < floorSides; k++) {
    const a0 = (k / floorSides) * TAU;
    const a1 = ((k + 1) / floorSides) * TAU;
    tri(wood, [apex, ring(a0, neck + 0.02, crown), ring(a1, neck + 0.02, crown)], UP, 0.15, still(apex, 0.4));
  }
  const capFoot = crown + lantern;
  const capTop = Y.at(0, capFoot + 0.5, 0);
  for (let k = 0; k < floorSides; k++) {
    const a0 = (k / floorSides) * TAU;
    const a1 = ((k + 1) / floorSides) * TAU;
    const n = normalize(addScaled(scale(radial((a0 + a1) / 2), 0.5), UP, 0.5));
    tri(roof, [ring(a0, 0.5, capFoot), ring(a1, 0.5, capFoot), capTop], n, 0.52, still(capTop, 0.6, { rot: 0.4 }));
    tri(roof, [ring(a1, 0.5, capFoot), ring(a0, 0.5, capFoot), Y.at(0, capFoot, 0)], [0, -1, 0], 0.22, still(capTop, 0.6));
  }
  const lean = Math.PI / 2 + Math.atan2(0.5, 0.5) - 0.05;
  const finial: Channels = { loss: 0, droop: 0, wither: 0.5, glow: 0, pivot: capTop, fall: [0, 0, lean, 0.3] };
  log(wood, addScaled(capTop, UP, -0.05), addScaled(capTop, UP, 0.42), 0.035, 0.45, finial, 6);
  box(wood, addScaled(capTop, UP, 0.46), [[1, 0, 0], UP, [0, 0, 1]], [0.06, 0.06, 0.06], 0.5, finial);

  // Doves on the ledges and at the flight holes, and the rest circling overhead; they all come home into the cote as it fails.
  const home = Y.at(0, crown + 0.2, 0);
  const perched = Math.max(1, Math.round(flock * 0.4));
  for (let i = 0; i < perched; i++) {
    const h = holes[Math.floor(r.next() * holes.length)] as { a: number; y: number };
    const onLedge = i % 2 === 0;
    const a = onLedge ? doorHalf + 0.3 + r.next() * (TAU - 2 * doorHalf - 0.6) : h.a;
    const c = onLedge ? ring(a, R + 0.12, 1.75 + 0.06 + 0.06) : ring(a, R + 0.12, h.y - 0.12 + 0.06);
    const t = onLedge ? normalize(addScaled(scale(tangent(a), r.next() < 0.5 ? -1 : 1), radial(a), 0.4)) : radial(a);
    dove(mortar, c, t, UP, 0, { loss: lossThreshold(r.next(), 0.6, 0.28), droop: 0, wither: 0.5, glow: 0, pivot: onLedge ? ring(a, R, 1.8) : ring(a, R - 0.1, h.y), tint: (r.next() - 0.5) * 0.03 });
  }
  circling(mortar, Y, flock - perched, H, home, r.fork("doves"));

  const cote = roundPlan(Y, R * 2 * Math.cos(Math.PI / 8) / 2 + 0.02, H);
  ivy(moss, cote, ruinOf(cote), r.fork("ivy"));
  weedsAbout(weed, Y, R + 0.1, R + 0.9, 12, r.fork("weeds"));
  const parts = [stone, mortar, wood, roof, moss, weed].filter((b) => b.triangleCount > 0).map((b) => b.part());
  return { parts, anchors: [] };
}

function postCote(flock: number, r: Rand, plan: BuildingPlan): Built {
  const Y = yard(plan, 1.6, -plan.depth * 0.15);
  const Z = Y.axes[2];
  const wood = new PartBuilder("timber", "solid");
  const paint = new PartBuilder("trim", "solid");
  const roof = new PartBuilder("roof", "solid");
  const birds = new PartBuilder("wall", "solid");
  const weed = new PartBuilder("leaf");
  const top = 3.0;
  const foot = Y.at(0, 0, 0);
  // A stout post braced at its foot, which rots and lets the cote lurch over on it.
  log(wood, Y.at(0, -0.7, 0), Y.at(0, top, 0), 0.11, 0.42, still(foot, 0.55, { rot: 0.35 }), 8);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const base = Y.at(Math.cos(a) * 0.62, -0.15, Math.sin(a) * 0.62);
    beam(wood, base, Y.at(Math.cos(a) * 0.08, 0.85, Math.sin(a) * 0.08), 0.08, 0.08, UP, 0.4, still(base, 0.55, { loss: k === 1 ? 0.18 : 0 }));
  }
  const head = Y.at(0, top, 0);
  // It lurches away from the house.
  const lurch = -0.24 * featureSide(plan);
  const held = (wither: number, extra: Partial<Channels> = {}): Channels => still(head, wither, { fall: [0, 0, lurch, 0.22], ...extra });
  box(wood, Y.at(0, top + 0.03, 0), Y.axes, [0.66, 0.03, 0.74], 0.45, held(0.55));
  for (const s of [-1, 1]) beam(wood, Y.at(0, top - 0.5, 0), Y.at(s * 0.5, top, 0), 0.07, 0.07, Z, 0.4, held(0.55));
  // The painted cote: a box under a pitched roof, two rows of arched doorways on each long side, each with a landing ledge.
  const hx = 0.5;
  const hz = 0.66;
  const h = 1.0;
  const y0 = top + 0.06;
  box(paint, Y.at(0, y0 + h / 2, 0), Y.axes, [hx, h / 2, hz], 0.55, held(0.6, { rot: 0.5 }));
  const ridge = y0 + h + 0.5;
  for (const s of [-1, 1]) {
    // The gable over each end, boarded and painted.
    const g = [Y.at(-hx, y0 + h, s * hz), Y.at(hx, y0 + h, s * hz), Y.at(0, ridge - 0.04, s * hz)] as const;
    facet(paint, g[0], g[1], g[2], 0.58, held(0.6, { rot: 0.45 }), Y.at(0, y0 + h, 0));
  }
  const doors: { c: V3; n: V3 }[] = [];
  for (const s of [-1, 1]) {
    const n = Y.dir(s, 0, 0);
    for (const [y, zs] of [[y0 + 0.18, [-2 / 3, 0, 2 / 3]], [y0 + 0.52, [-1 / 3, 1 / 3]]] as const) {
      for (const zf of zs) {
        const c = Y.at(s * (hx + 0.006), y, zf * hz);
        doors.push({ c, n });
        const w = 0.075;
        const arch: V3[] = [];
        for (let q = 0; q <= 4; q++) arch.push(addScaled(addScaled(c, Z, Math.cos((q / 4) * Math.PI) * w), UP, 0.09 + Math.sin((q / 4) * Math.PI) * w));
        quad(wood, [addScaled(c, Z, -w), addScaled(c, Z, w), arch[0] as V3, arch[4] as V3], n, 0, held(0.3));
        for (let q = 0; q < 4; q++) tri(wood, [addScaled(c, UP, 0.09), arch[q] as V3, arch[q + 1] as V3], n, 0, held(0.3));
        box(wood, addScaled(addScaled(c, n, 0.07), UP, -0.02), [Z, UP, n], [w + 0.04, 0.015, 0.08], 0.5, held(0.55));
      }
    }
  }
  const eaveY = y0 + h - 0.06;
  const over = 0.16;
  for (const s of [-1, 1]) {
    const e0 = Y.at(s * (hx + over), eaveY, -hz - over);
    const e1 = Y.at(s * (hx + over), eaveY, hz + over);
    slope(roof, e0, e1, Y.at(0, ridge, hz + over), Y.at(0, ridge, -hz - over), 3, Y.dir(s, 1, 0), (q) => held(0.6, { rot: clamp(0.35 + 0.4 * r.next() + 0.15 * (q[1] - eaveY), 0, 1), droop: 0.04 }), r);
    box(wood, Y.at(s * (hx + over), eaveY - 0.02, 0), Y.axes, [0.02, 0.05, hz + over], 0.4, held(0.55));
  }
  beam(wood, Y.at(0, ridge + 0.03, -hz - over - 0.04), Y.at(0, ridge + 0.03, hz + over + 0.04), 0.07, 0.09, UP, 0.5, held(0.5));
  for (const s of [-1, 1]) log(wood, Y.at(0, ridge, s * (hz + over)), Y.at(0, ridge + 0.3, s * (hz + over)), 0.03, 0.45, held(0.5, { loss: 0.3 }), 6);

  // Doves on the ledges and the ridge, and the rest circling; they go in at the doorways as the cote fails.
  const perched = Math.max(1, Math.round(flock * 0.45));
  for (let i = 0; i < perched; i++) {
    const d = doors[Math.floor(r.next() * doors.length)] as { c: V3; n: V3 };
    const onRidge = i % 3 === 2;
    const c = onRidge ? Y.at(0, ridge + 0.12, (r.next() - 0.5) * hz * 1.6) : addScaled(addScaled(d.c, d.n, 0.1), UP, 0.05);
    const t = onRidge ? normalize(addScaled(Y.dir(r.next() < 0.5 ? -1 : 1, 0, 0), Z, (r.next() - 0.5) * 0.8)) : d.n;
    dove(birds, c, t, UP, 0, { loss: lossThreshold(r.next(), 0.6, 0.28), droop: 0, wither: 0.5, glow: 0, pivot: onRidge ? Y.at(0, ridge, 0) : d.c, tint: (r.next() - 0.5) * 0.03 });
  }
  circling(birds, Y, flock - perched, ridge, Y.at(0, y0 + h / 2, 0), r.fork("doves"));
  weedsAbout(weed, Y, 0.25, 1.0, 8, r.fork("weeds"));
  const parts = [wood, paint, roof, birds, weed].filter((b) => b.triangleCount > 0).map((b) => b.part());
  return { parts, anchors: [] };
}

// ---------- shared stonework ----------

/**
 * A block of squared stones over [x0, x1] × [z0, z1] in the yard's frame,
 * from `y0` up to `y1` in courses that break joint round a plain core;
 * `ch` gives each stone's channels from its course.
 */
function stoneBlock(b: PartBuilder, Y: Yard, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, rows: number, r: Rand, ch: (row: number, c: V3) => Channels): void {
  const [X, , Z] = Y.axes;
  const h = (y1 - y0) / rows;
  const deep = 0.1;
  const faces = [
    { n: X, u: Z, at: (s: number, y: number, d: number) => Y.at(x1 - d, y, s), from: z0, to: z1 },
    { n: scale(X, -1), u: Z, at: (s: number, y: number, d: number) => Y.at(x0 + d, y, s), from: z0, to: z1 },
    { n: Z, u: X, at: (s: number, y: number, d: number) => Y.at(s, y, z1 - d), from: x0 + 2 * deep, to: x1 - 2 * deep },
    { n: scale(Z, -1), u: X, at: (s: number, y: number, d: number) => Y.at(s, y, z0 + d), from: x0 + 2 * deep, to: x1 - 2 * deep },
  ];
  for (let j = 0; j < rows; j++) {
    const yc = y0 + h * (j + 0.5);
    for (const f of faces) {
      let s = f.from - (j % 2) * 0.17;
      while (s < f.to - 0.04) {
        const s0 = Math.max(f.from, s);
        const s1 = Math.min(f.to, s + 0.32 + 0.2 * r.next());
        const c = f.at((s0 + s1) / 2, yc, deep - 0.012 * r.next());
        box(b, c, [f.u, UP, f.n], [(s1 - s0) / 2 - 0.012, h / 2 - 0.011, deep], 0.4 + 0.24 * r.next(), ch(j, c), { bottom: j > 0 });
        s = s1;
      }
    }
  }
  const core = Y.at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  box(b, core, Y.axes, [(x1 - x0) / 2 - 0.05, (y1 - y0) / 2 - 0.004, (z1 - z0) / 2 - 0.05], 0.3, ch(rows - 1, core));
}

// ---------- well ----------

/** A wooden bucket hanging on its rope, `bottom` at its foot; it falls into the well as the code fails. */
function bucket(b: PartBuilder, c: V3, ch: Channels): void {
  const sides = 10;
  const h = 0.28;
  const at = (k: number, rad: number, y: number): V3 => [c[0] + Math.cos((k / sides) * TAU) * rad, c[1] + y, c[2] + Math.sin((k / sides) * TAU) * rad];
  for (let k = 0; k < sides; k++) {
    const n: V3 = [Math.cos(((k + 0.5) / sides) * TAU), 0.1, Math.sin(((k + 0.5) / sides) * TAU)];
    quad(b, [at(k, 0.14, 0), at(k + 1, 0.14, 0), at(k + 1, 0.17, h), at(k, 0.17, h)], n, 0.46 + 0.06 * (k % 2), ch);
    for (const [y, rad] of [[0.05, 0.149], [h - 0.05, 0.168]] as const) quad(b, [at(k, rad, y - 0.025), at(k + 1, rad, y - 0.025), at(k + 1, rad + 0.006, y + 0.025), at(k, rad + 0.006, y + 0.025)], n, 0.22, ch);
    tri(b, [[c[0], c[1] + 0.02, c[2]], at(k + 1, 0.14, 0.02), at(k, 0.14, 0.02)], UP, 0.3, ch);
  }
  // Its bail, an arc over the top.
  let last = at(0, 0.17, h);
  for (let k = 1; k <= 4; k++) {
    const a = (k / 4) * Math.PI;
    const p: V3 = [c[0] + Math.cos(a) * 0.17, c[1] + h + Math.sin(a) * 0.12, c[2]];
    beam(b, last, p, 0.018, 0.018, [0, 0, 1], 0.3, ch);
    last = p;
  }
}

export function buildWell(p: Resolved<typeof wellParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("well");
  const inner = p.width;
  const outer = inner + 0.3;
  const Y = yard(plan, 2.0 + outer, -0.25);
  const stone = new PartBuilder("masonry", "solid");
  const water = new PartBuilder("glass");
  const wood = new PartBuilder("timber", "solid");
  const roof = new PartBuilder("roof", "solid");
  const moss = new PartBuilder("moss");
  const weed = new PartBuilder("leaf");
  const ring = (a: number, d: number, y: number): V3 => Y.at(Math.cos(a) * d, y, Math.sin(a) * d);
  const radial = (a: number): V3 => Y.dir(Math.cos(a), 0, Math.sin(a));
  const tangent = (a: number): V3 => Y.dir(-Math.sin(a), 0, Math.cos(a));
  const mid = (inner + outer) / 2;
  const deep = Y.at(0, -1.2, 0);

  // Courses of stones round the shaft under flat coping stones, a few of which work loose and fall in as the well is left.
  const courses: readonly (readonly [number, number])[] = [[-0.5, -0.2], [-0.2, 0.1], [0.1, 0.4], [0.4, 0.7]];
  for (const [j, [y0, y1]] of courses.entries()) {
    const count = Math.max(9, Math.round((TAU * outer) / (0.42 + 0.1 * r.next())));
    const shift = r.next() * TAU;
    for (let k = 0; k < count; k++) {
      const a = shift + ((k + 0.5) / count) * TAU;
      box(stone, ring(a, mid + 0.015 * (r.next() - 0.5), (y0 + y1) / 2), [tangent(a), UP, radial(a)], [outer * Math.sin(Math.PI / count) - 0.014, (y1 - y0) / 2 - 0.012, 0.15], 0.4 + 0.22 * r.next(), still(ring(a, mid, y0), 0.35 + 0.35 * r.next(), { tint: (r.next() - 0.5) * 0.05 }), { bottom: j > 0 });
    }
  }
  const slabs = Math.max(8, Math.round((TAU * outer) / 0.62));
  const top = 0.82;
  for (let k = 0; k < slabs; k++) {
    const a = ((k + 0.5) / slabs) * TAU;
    const loose = k % 4 === 1 ? lossThreshold(r.next(), 0.3, 0.06) : 0;
    box(stone, ring(a, mid + 0.01, top - 0.06), [tangent(a), UP, radial(a)], [(outer + 0.06) * Math.sin(Math.PI / slabs) - 0.012, 0.06, 0.2], 0.58 + 0.08 * r.next(), still(loose > 0 ? ring(a, inner * 0.4, -0.5) : ring(a, mid, top - 0.12), 0.4 + 0.3 * r.next(), { loss: loose, tint: (r.next() - 0.5) * 0.04 }));
  }
  // The shaft goes down dark below the stones to water that sinks away as the code fails.
  const sides = 14;
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * TAU;
    const a1 = ((k + 1) / sides) * TAU;
    quad(stone, [ring(a0, inner + 0.02, -1.3), ring(a1, inner + 0.02, -1.3), ring(a1, inner + 0.02, -0.45), ring(a0, inner + 0.02, -0.45)], scale(radial((a0 + a1) / 2), -1), 0.08, still(deep, 0.4));
    tri(water, [Y.at(0, -0.32, 0), ring(a0, inner + 0.03, -0.32), ring(a1, inner + 0.03, -0.32)], UP, 0.5, { loss: 0.38, droop: 0, wither: 0, glow: 0, pivot: deep });
  }

  const falls = Y.at(0, -1.0, 0);
  const lost = { loss: 0.33, droop: 0, wither: 0.55, glow: 0, pivot: falls };
  if (p.head === "a sweep") {
    // A forked post beside the well carries a long pole, its bucket end lowered over the shaft and a stone weight at the other.
    const postX = outer + 0.95;
    log(wood, Y.at(postX, -0.6, 0), Y.at(postX, 1.95, 0), 0.12, 0.42, still(Y.at(postX, 0, 0), 0.55, { rot: 0.3 }), 8);
    for (const s of [-1, 1]) log(wood, Y.at(postX, 1.85, 0), Y.at(postX, 2.3, s * 0.13), 0.06, 0.42, still(Y.at(postX, 1.9, 0), 0.55), 6);
    const pin = Y.at(postX, 2.15, 0);
    log(wood, addScaled(pin, [0, 0, 1], -0.16), addScaled(pin, [0, 0, 1], 0.16), 0.03, 0.3, still(pin, 0.5), 6);
    const tip = Y.at(0, 1.75, 0);
    const along = normalize(sub(pin, tip));
    const far = addScaled(pin, along, 1.9);
    // As the well fails the pole tips, its bucket end down to the coping, once the bucket has gone.
    const tipped = { loss: 0, droop: 0, wither: 0.55, glow: 0, pivot: pin, fall: [0, 0, 0.26 * featureSide(plan), 0.24] as const };
    log(wood, addScaled(tip, along, -0.08), far, 0.07, 0.45, tipped, 7);
    lump(stone, addScaled(far, UP, -0.32), [0.24, 0.2, 0.22], r.next() * Math.PI, 0.45, tipped, r);
    beam(wood, far, addScaled(far, UP, -0.2), 0.025, 0.025, [1, 0, 0], 0.3, tipped);
    beam(wood, tip, Y.at(0, 1.3, 0), 0.025, 0.025, [1, 0, 0], 0.32, { ...lost, pivot: tip });
  } else {
    // Two posts carry a little shingled roof over a winch, its crank at one end.
    const postZ = outer + 0.09;
    const ridgeY = 2.6;
    for (const s of [-1, 1]) {
      const base = Y.at(0, -0.45, s * postZ);
      beam(wood, base, Y.at(0, ridgeY - 0.05, s * postZ), 0.14, 0.14, [1, 0, 0], 0.42, still(base, 0.55, { rot: 0.3 }));
    }
    const winch = 1.5;
    log(wood, Y.at(0, winch, -postZ), Y.at(0, winch, postZ), 0.085, 0.42, still(Y.at(0, winch, 0), 0.55), 8);
    const crank = Y.at(0, winch, postZ + 0.16);
    log(wood, Y.at(0, winch, postZ - 0.05), crank, 0.03, 0.35, still(crank, 0.5), 6);
    beam(wood, crank, addScaled(crank, Y.dir(0.3, -0.25, 0), 1), 0.04, 0.04, [0, 0, 1], 0.35, still(crank, 0.5, { fall: [0, 0, 0.9, 0.25] }));
    beam(wood, Y.at(0, winch - 0.08, 0), Y.at(0, 1.3, 0), 0.025, 0.025, [1, 0, 0], 0.32, { ...lost, pivot: Y.at(0, winch, 0) });
    const eaveX = outer * 0.75 + 0.25;
    const eaveY = 1.85;
    const endZ = postZ + 0.32;
    const sag = (q: V3): Channels => ({ loss: 0, droop: 0.06, wither: 0.6, glow: 0, pivot: Y.at(0, ridgeY, 0), rot: clamp(0.35 + 0.35 * r.next() + 0.25 * (ridgeY - q[1]), 0, 1) });
    for (const s of [-1, 1]) {
      slope(roof, Y.at(s * eaveX, eaveY, -endZ), Y.at(s * eaveX, eaveY, endZ), Y.at(0, ridgeY, endZ), Y.at(0, ridgeY, -endZ), 3, Y.dir(s, 1, 0), sag, r);
      for (const z of [-endZ, endZ]) beam(wood, Y.at(0, ridgeY + 0.02, z), Y.at(s * (eaveX + 0.04), eaveY - 0.02, z), 0.12, 0.035, [0, 0, 1], 0.45, still(Y.at(0, ridgeY, z), 0.55, { droop: 0.04 }));
      beam(wood, Y.at(-eaveX + 0.1, eaveY - 0.1, s * postZ), Y.at(eaveX - 0.1, eaveY - 0.1, s * postZ), 0.1, 0.1, UP, 0.42, still(Y.at(0, eaveY, s * postZ), 0.55));
    }
    beam(wood, Y.at(0, ridgeY + 0.04, -endZ - 0.03), Y.at(0, ridgeY + 0.04, endZ + 0.03), 0.08, 0.1, UP, 0.48, still(Y.at(0, ridgeY, 0), 0.5));
  }
  bucket(wood, Y.at(0, 0.98, 0), lost);

  // Moss creeps over the coping and rank grass round the foot.
  for (let k = 0; k < 6; k++) {
    const a = r.next() * TAU;
    lump(moss, ring(a, mid + (r.next() - 0.5) * 0.15, top), [0.13 + 0.06 * r.next(), 0.035, 0.09], a, 0.5, { loss: 0, droop: 0, wither: 0.3, glow: 0, pivot: ring(a, mid, top), tint: (r.next() - 0.5) * 0.06, grow: 0.3 + 0.25 * r.next() }, r);
  }
  weedsAbout(weed, Y, outer + 0.05, outer + 0.8, 12, r.fork("weeds"));
  const parts = [stone, water, wood, roof, moss, weed].filter((b) => b.triangleCount > 0).map((b) => b.part());
  return { parts, anchors: [] };
}

// ---------- bell ----------

/** A bell's outer profile from its lip up to its crown, as (radius, height) in parts of its mouth's radius. */
const BELL_PROFILE: readonly (readonly [number, number])[] = [[1, 0], [0.97, 0.07], [0.86, 0.17], [0.7, 0.36], [0.61, 0.6], [0.58, 0.84], [0.5, 0.97], [0.32, 1.03], [0, 1.05]];

/** A cast bell of mouth radius `B` hanging from `hang`, its clapper inside; it hangs askew and then is gone as the code fails. */
function castBell(b: PartBuilder, hang: V3, B: number, ch: Channels): void {
  const sides = 14;
  const H = 1.15 * B;
  const lip = hang[1] - 0.06 - H * 1.05;
  const at = (k: number, rad: number, y: number): V3 => [hang[0] + Math.cos((k / sides) * TAU) * rad * B, lip + y * H, hang[2] + Math.sin((k / sides) * TAU) * rad * B];
  for (let j = 0; j + 1 < BELL_PROFILE.length; j++) {
    const [r0, y0] = BELL_PROFILE[j] as readonly [number, number];
    const [r1, y1] = BELL_PROFILE[j + 1] as readonly [number, number];
    for (let k = 0; k < sides; k++) {
      const a = ((k + 0.5) / sides) * TAU;
      const n = normalize([Math.cos(a) * (y1 - y0) * H, (r0 - r1) * B, Math.sin(a) * (y1 - y0) * H]);
      if (r1 < 1e-6) tri(b, [at(k, r0, y0), at(k + 1, r0, y0), at(k, 0, y1)], n, 0.62, ch);
      else quad(b, [at(k, r0, y0), at(k + 1, r0, y0), at(k + 1, r1, y1), at(k, r1, y1)], n, 0.5 + 0.25 * y0, ch);
    }
  }
  // The lip's underside and the dark inside of the bell.
  for (let k = 0; k < sides; k++) {
    const a = ((k + 0.5) / sides) * TAU;
    quad(b, [at(k, 0.88, 0), at(k + 1, 0.88, 0), at(k + 1, 1, 0), at(k, 1, 0)], [0, -1, 0], 0.3, ch);
    quad(b, [at(k, 0.88, 0), at(k + 1, 0.88, 0), at(k + 1, 0.5, 0.8), at(k, 0.5, 0.8)], [-Math.cos(a), -0.4, -Math.sin(a)], 0.05, ch);
    tri(b, [at(k, 0.5, 0.8), at(k + 1, 0.5, 0.8), at(0, 0, 0.9)], [0, -1, 0], 0.04, ch);
  }
  // The crown's loop up to the headstock, and the clapper hanging inside.
  box(b, [hang[0], hang[1] - 0.03 - 0.04 * B, hang[2]], [[1, 0, 0], UP, [0, 0, 1]], [0.05 + 0.08 * B, 0.03 + 0.06 * B, 0.03 + 0.04 * B], 0.5, ch);
  log(b, [hang[0], lip + 0.85 * H, hang[2]], [hang[0], lip - 0.05 * B, hang[2]], 0.025 + 0.02 * B, 0.3, ch, 6);
  box(b, [hang[0], lip - 0.05 * B, hang[2]], [[1, 0, 0], UP, [0, 0, 1]], [0.06 * B + 0.03, 0.08 * B + 0.03, 0.06 * B + 0.03], 0.35, ch);
}

export function buildBell(p: Resolved<typeof bellParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("bell");
  const B = p.bell;
  // Turned so its arch faces the front, the way a person walks up.
  const Y = turned(yard(plan, 2.4, -plan.depth * 0.18));
  const stone = new PartBuilder("masonry", "solid");
  const wood = new PartBuilder("timber", "solid");
  const roof = new PartBuilder("roof", "solid");
  const metal = new PartBuilder("glass");
  const weed = new PartBuilder("leaf");
  const [X, , Z] = Y.axes;
  const half = B + 0.3;
  const spring = 2.05;
  const hang = Y.at(0, spring + 0.02, 0);
  // The bell hangs askew from one strap as the code fails, then it is gone.
  const askew = 0.5 * featureSide(plan);
  const along = Y.dir(0, 0, askew);
  const swung = (wither: number): Channels => ({ loss: 0.14, droop: 0, wither, glow: 0, pivot: hang, fall: [along[0], along[1], along[2], 0.4] });
  let ridgeY: number;
  let span: number;
  let eaveX: number;
  if (p.hanging === "a timber frame") {
    // Two A-frames of raked legs joined by the headstock, braced low and high.
    const legZ = half + 0.2;
    for (const s of [-1, 1]) {
      for (const lx of [-1, 1]) {
        const base = Y.at(lx * 0.62, -0.4, s * legZ);
        beam(wood, base, Y.at(lx * 0.07, spring + 0.12, s * legZ), 0.13, 0.13, Z, 0.42 + 0.05 * r.next(), still(base, 0.55, { rot: 0.35 }));
      }
      beam(wood, Y.at(-0.5, 0.75, s * legZ), Y.at(0.5, 0.75, s * legZ), 0.1, 0.08, UP, 0.42, still(Y.at(0, 0.75, s * legZ), 0.55, { loss: s > 0 ? 0.2 : 0 }));
      beam(wood, Y.at(-0.26, spring - 0.45, s * legZ), Y.at(0.26, spring - 0.45, s * legZ), 0.09, 0.08, UP, 0.42, still(Y.at(0, spring - 0.45, s * legZ), 0.55));
      // A king post from the headstock up to the ridge.
      beam(wood, Y.at(0, spring + 0.12, s * legZ), Y.at(0, spring + 0.85, s * legZ), 0.1, 0.1, Z, 0.42, still(Y.at(0, spring, s * legZ), 0.55));
    }
    for (const lx of [-1, 1]) beam(wood, Y.at(lx * 0.53, 0.6, -legZ), Y.at(lx * 0.53, 0.6, legZ), 0.09, 0.08, UP, 0.42, still(Y.at(lx * 0.53, 0.6, 0), 0.55, { rot: 0.3 }));
    beam(wood, Y.at(0, spring + 0.12, -legZ - 0.1), Y.at(0, spring + 0.12, legZ + 0.1), 0.16, 0.14, UP, 0.45, still(hang, 0.55));
    ridgeY = spring + 0.85;
    span = legZ + 0.32;
    eaveX = 0.62;
  } else {
    // Two stone piers and a round arch of voussoirs, the walling above it up to a little roof.
    const pier = 0.46;
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? half : -half - pier;
      stoneBlock(stone, Y, -pier / 2, pier / 2, z0, z0 + pier, -0.5, spring, 8, r, (_, c) => still(c, 0.35 + 0.3 * r.next(), { tint: (r.next() - 0.5) * 0.05 }));
    }
    const arch = 7;
    const rise = half + 0.16;
    for (let k = 0; k < arch; k++) {
      const a0 = (k / arch) * Math.PI;
      const a1 = ((k + 1) / arch) * Math.PI;
      const from = Y.at(0, spring + Math.sin(a0) * rise, Math.cos(a0) * rise);
      const to = Y.at(0, spring + Math.sin(a1) * rise, Math.cos(a1) * rise);
      beam(stone, from, to, pier, 0.3, X, 0.56 + 0.08 * r.next(), still(Y.at(0, spring, 0), 0.4));
    }
    // Courses over the arch, cut back to its curve.
    const wallTop = spring + rise + 0.32;
    const outerZ = half + pier;
    for (let y = spring; y < wallTop - 0.02; y += 0.26) {
      const y1 = Math.min(wallTop, y + 0.26);
      const dy = (y + y1) / 2 - spring;
      const open = dy < rise + 0.14 ? Math.sqrt(Math.max(0, (rise + 0.15) ** 2 - dy * dy)) : 0;
      const runs: [number, number][] = open > 0.05 ? [[-outerZ, -open], [open, outerZ]] : [[-outerZ, outerZ]];
      for (const [z0, z1] of runs) {
        if (z1 - z0 < 0.08) continue;
        const pieces = Math.max(1, Math.round((z1 - z0) / 0.4));
        for (let k = 0; k < pieces; k++) {
          const a = z0 + ((z1 - z0) * k) / pieces;
          const bz = z0 + ((z1 - z0) * (k + 1)) / pieces;
          const c = Y.at(0, (y + y1) / 2, (a + bz) / 2);
          box(stone, c, [Z, UP, X], [(bz - a) / 2 - 0.012, (y1 - y) / 2 - 0.01, pier / 2 - 0.02], 0.42 + 0.22 * r.next(), still(c, 0.35 + 0.3 * r.next(), { tint: (r.next() - 0.5) * 0.05 }));
        }
      }
    }
    beam(wood, Y.at(0, spring + 0.02, -half - 0.1), Y.at(0, spring + 0.02, half + 0.1), 0.14, 0.14, UP, 0.42, still(hang, 0.55));
    ridgeY = wallTop + 0.55;
    span = outerZ + 0.18;
    eaveX = pier / 2 + 0.3;
  }
  // A little roof over it all, rotting through and sagging as the code fails.
  const eaveY = ridgeY - 0.55;
  const sag = (q: V3): Channels => ({ loss: 0, droop: 0.05, wither: 0.6, glow: 0, pivot: Y.at(0, ridgeY, 0), rot: clamp(0.35 + 0.35 * r.next() + 0.3 * (ridgeY - q[1]), 0, 1) });
  for (const s of [-1, 1]) {
    slope(roof, Y.at(s * eaveX, eaveY, -span), Y.at(s * eaveX, eaveY, span), Y.at(0, ridgeY, span), Y.at(0, ridgeY, -span), 3, Y.dir(s, 1, 0), sag, r);
    for (const z of [-span, span]) beam(wood, Y.at(0, ridgeY + 0.02, z), Y.at(s * (eaveX + 0.04), eaveY - 0.02, z), 0.12, 0.035, Z, 0.45, still(Y.at(0, ridgeY, z), 0.55, { droop: 0.04 }));
  }
  beam(wood, Y.at(0, ridgeY + 0.04, -span - 0.03), Y.at(0, ridgeY + 0.04, span + 0.03), 0.08, 0.1, UP, 0.48, still(Y.at(0, ridgeY, 0), 0.5));
  for (const s of [-1, 1]) facet(wood, Y.at(-eaveX + 0.08, eaveY + 0.02, s * (span - 0.05)), Y.at(eaveX - 0.08, eaveY + 0.02, s * (span - 0.05)), Y.at(0, ridgeY - 0.06, s * (span - 0.05)), 0.4, still(Y.at(0, ridgeY, 0), 0.55, { rot: 0.4 }), Y.at(0, eaveY, 0));

  castBell(metal, hang, B, swung(0.2));
  // A lever on the headstock and a rope down from it, to ring the bell by.
  const lever = Y.at(0.5, spring + 0.02, 0);
  beam(wood, Y.at(0, spring + 0.02, 0), lever, 0.06, 0.05, Z, 0.4, swung(0.55));
  beam(wood, lever, Y.at(0.5, 1.05, 0), 0.025, 0.025, Z, 0.36, swung(0.5));
  beam(wood, Y.at(0.5, 1.45, 0), Y.at(0.5, 1.15, 0), 0.05, 0.05, Z, 0.62, swung(0.5));
  weedsAbout(weed, Y, 0.3, 1.3, 10, r.fork("weeds"));
  const parts = [stone, wood, roof, metal, weed].filter((b) => b.triangleCount > 0).map((b) => b.part());
  return { parts, anchors: [] };
}

// ---------- forge ----------

export function buildForge(p: Resolved<typeof forgeParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("forge");
  const Y = yard(plan, 0, -plan.depth * 0.2);
  const [X, , Z] = Y.axes;
  const stone = new PartBuilder("masonry", "solid");
  const plaster = new PartBuilder("wall", "solid");
  const wood = new PartBuilder("timber", "solid");
  const roof = new PartBuilder("roof", "solid");
  const iron = new PartBuilder("glass");
  const puffs = new PartBuilder("smoke");
  const weed = new PartBuilder("leaf");
  const stoneCh = (_: number, c: V3): Channels => still(c, 0.35 + 0.35 * r.next(), { tint: (r.next() - 0.5) * 0.05 });

  // The chimney stack nearest the house, the hearth before it at working height, and the plastered hood between them.
  const stack = p.stack;
  stoneBlock(stone, Y, 1.15, 1.7, -0.4, 0.4, -0.4, stack, Math.round((stack + 0.4) / 0.3), r, stoneCh);
  const capC = Y.at(1.425, stack + 0.06, 0);
  box(stone, capC, Y.axes, [0.33, 0.06, 0.46], 0.6, still(capC, 0.45));
  const pot = addScaled(capC, UP, 0.06);
  log(stone, pot, addScaled(pot, UP, 0.3), 0.12, 0.4, still(pot, 0.5), 7);
  smoke(puffs, addScaled(pot, UP, 0.38), r.fork("smoke"));
  const hearthTop = 0.82;
  stoneBlock(stone, Y, 1.7, 2.6, -0.6, 0.6, -0.35, hearthTop, 4, r, stoneCh);
  // A fire pit ringed with stones, its coals glowing at dusk while the code is healthy and dying out as it fails.
  for (const [cx, cz, hx, hz] of [[2.15, -0.3, 0.3, 0.04], [2.15, 0.3, 0.3, 0.04], [1.88, 0, 0.04, 0.26], [2.42, 0, 0.04, 0.26]] as const) {
    const c = Y.at(cx, hearthTop + 0.05, cz);
    box(stone, c, Y.axes, [hx, 0.05, hz], 0.35, still(c, 0.5));
  }
  const bed = Y.at(2.15, hearthTop, 0);
  for (let k = 0; k < 14; k++) {
    // Heaped high in the middle, so the glow shows over the stones round it.
    const dx = (r.next() - 0.5) * 0.42;
    const dz = (r.next() - 0.5) * 0.46;
    const c = Y.at(2.15 + dx, hearthTop + 0.1 - 0.12 * Math.hypot(dx, dz), dz);
    lump(iron, c, [0.08 + 0.04 * r.next(), 0.06, 0.07 + 0.03 * r.next()], r.next() * Math.PI, 0.6, { loss: lossThreshold(r.next(), 0.72, 0.34), droop: 0, wither: 0.3, glow: 1, pivot: bed }, r);
  }
  const hood = still(Y.at(2.1, 1.9, 0), 0.6);
  const lipX = 2.55;
  const lipY = 1.6;
  const backY = 2.35;
  const hoodRot = (y: number): Channels => ({ ...hood, rot: clamp(0.3 + 0.4 * (y - lipY) + 0.15 * r.next(), 0, 1) });
  quad(plaster, [Y.at(lipX, lipY, -0.62), Y.at(lipX, lipY, 0.62), Y.at(1.72, backY, 0.4), Y.at(1.72, backY, -0.4)], normalize(Y.dir(backY - lipY, lipX - 1.72, 0)), 0.55, hoodRot(lipY));
  for (const s of [-1, 1]) facet(plaster, Y.at(1.7, lipY, s * 0.62), Y.at(lipX, lipY, s * 0.62), Y.at(1.72, backY, s * 0.4), 0.5, hoodRot(backY), Y.at(2.1, 1.9, 0));
  quad(plaster, [Y.at(1.7, lipY, -0.62), Y.at(lipX, lipY, -0.62), Y.at(lipX, lipY, 0.62), Y.at(1.7, lipY, 0.62)], [0, -1, 0], 0.08, hood);
  beam(wood, Y.at(lipX + 0.02, lipY - 0.06, -0.7), Y.at(lipX + 0.02, lipY - 0.06, 0.7), 0.14, 0.12, UP, 0.42, still(Y.at(lipX, lipY, 0), 0.55));
  for (const s of [-1, 1]) beam(wood, Y.at(lipX - 0.02, hearthTop, s * 0.6), Y.at(lipX - 0.02, lipY - 0.12, s * 0.6), 0.1, 0.1, Z, 0.42, still(Y.at(lipX, hearthTop, s * 0.6), 0.55));

  // The anvil on its stump, tongs leaning against it and a hammer on its face; a quench trough by the hearth.
  const stumpAt = Y.at(3.35, 0, -0.35);
  log(wood, addScaled(stumpAt, UP, -0.12), addScaled(stumpAt, UP, 0.5), 0.24, 0.4, still(stumpAt, 0.55, { rot: 0.3 }), 9);
  const ironCh = still(stumpAt, 0.2);
  const anvil = (dx: number, y: number, dz: number, half: readonly [number, number, number]): void => box(iron, Y.at(3.35 + dx, y, -0.35 + dz), Y.axes, half, 0.45, ironCh);
  anvil(0, 0.54, 0, [0.12, 0.04, 0.2]);
  anvil(0, 0.64, 0, [0.07, 0.06, 0.12]);
  anvil(0, 0.76, 0, [0.09, 0.06, 0.22]);
  const hornFoot = Y.at(3.35, 0.77, -0.35 + 0.22);
  const hornTip = Y.at(3.35, 0.8, -0.35 + 0.5);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * TAU;
    const a1 = ((k + 1) / 6) * TAU;
    const rim = (a: number): V3 => addScaled(addScaled(hornFoot, X, Math.cos(a) * 0.075), UP, Math.sin(a) * 0.05);
    facet(iron, rim(a0), rim(a1), hornTip, 0.45, ironCh, hornFoot);
  }
  beam(wood, Y.at(3.3, 0.86, -0.42), Y.at(3.05, 0.86, -0.1), 0.03, 0.03, UP, 0.5, ironCh);
  box(iron, Y.at(3.32, 0.86, -0.44), Y.axes, [0.06, 0.035, 0.035], 0.4, ironCh);
  for (const dz of [-0.04, 0.04]) beam(iron, Y.at(3.66, 0, -0.2 + dz), Y.at(3.55, 0.52, -0.3 + dz * 2), 0.018, 0.018, Z, 0.4, ironCh);
  const troughAt = Y.at(2.38, 0, 1.05);
  const trough = still(troughAt, 0.55, { rot: 0.35 });
  for (const [dx, dz, hx, hz] of [[0, -0.2, 0.4, 0.03], [0, 0.2, 0.4, 0.03], [-0.37, 0, 0.03, 0.17], [0.37, 0, 0.03, 0.17]] as const) box(wood, Y.at(2.38 + dx, 0.22, 1.05 + dz), Y.axes, [hx, 0.27, hz], 0.42 + 0.06 * r.next(), trough);
  quad(iron, [Y.at(2.02, 0.38, 0.88), Y.at(2.74, 0.38, 0.88), Y.at(2.74, 0.38, 1.22), Y.at(2.02, 0.38, 1.22)], UP, 0.5, { loss: 0.4, droop: 0, wither: 0, glow: 0, pivot: Y.at(2.38, -0.2, 1.05) });
  for (let k = 0; k < 4; k++) lump(stone, Y.at(2.8 + 0.25 * r.next(), 0.02, 0.45 + 0.3 * r.next()), [0.14, 0.07, 0.11], r.next() * Math.PI, 0.05, still(Y.at(2.9, 0, 0.6), 0.2), r);

  if (p.shelter === "an open shed") {
    // Four posts carry plates and rafters under one slope falling away from
    // the house. As the forge fails the covering rots and falls in, then
    // the rafters and plates, and last the outer posts lean and fall.
    const inX = 0.9;
    const outX = 4.05;
    const edge = 1.45;
    const hiY = 2.85;
    const loY = 2.2;
    for (const [x, y] of [[inX, hiY], [outX, loY]] as const) {
      for (const s of [-1, 1]) {
        const base = Y.at(x, -0.4, s * edge);
        // An outer post tips out, away from the house: about up × out.
        const falls = x === outX ? { fall: [0, s * 0.3, -featureSide(plan) * 1.25, 0.13] as const } : {};
        beam(wood, base, Y.at(x, y, s * edge), 0.15, 0.15, X, 0.42 + 0.05 * r.next(), still(Y.at(x, 0, s * edge), 0.55, { rot: 0.3, ...falls }));
      }
      beam(wood, Y.at(x, y + 0.06, -edge - 0.2), Y.at(x, y + 0.06, edge + 0.2), 0.13, 0.15, UP, 0.44, still(Y.at(x, 0, 0), 0.55, { loss: 0.16 }));
    }
    const rise = (x: number): number => hiY + 0.14 + ((loY - hiY) * (x - inX)) / (outX - inX);
    for (const z of [-edge, -edge / 3, edge / 3, edge]) beam(wood, Y.at(inX - 0.2, rise(inX - 0.2), z), Y.at(outX + 0.25, rise(outX + 0.25), z), 0.12, 0.08, UP, 0.42, still(Y.at(2.4, 0, z), 0.55, { loss: 0.16 }));
    const covering = (q: V3): Channels => ({ loss: lossThreshold(r.next(), 0.36, 0.24), droop: 0.05, wither: 0.6, glow: 0, pivot: [q[0], 0, q[2]], rot: clamp(0.3 + 0.4 * r.next(), 0, 1) });
    const span = edge + 0.25;
    for (const [z0, z1] of [[-span, -span / 3], [-span / 3, span / 3], [span / 3, span]] as const) {
      slope(roof, Y.at(outX + 0.3, rise(outX + 0.3) + 0.05, z0), Y.at(outX + 0.3, rise(outX + 0.3) + 0.05, z1), Y.at(inX - 0.25, rise(inX - 0.25) + 0.05, z1), Y.at(inX - 0.25, rise(inX - 0.25) + 0.05, z0), 4, UP, covering, r);
    }
  }
  weedsAbout(weed, Y, 0.1, 0.9, 6, r.fork("weeds"));
  for (let k = 0; k < 8; k++) {
    const p0 = Y.at(1.0 + 3.2 * r.next(), 0, (r.next() < 0.5 ? -1 : 1) * (1.0 + 0.5 * r.next()));
    weeds(weed, [{ x: p0[0], z: p0[2], grow: 0.2 + 0.3 * r.next(), size: 0.4 + 0.3 * r.next() }], r);
  }
  const parts = [stone, plaster, wood, roof, iron, puffs, weed].filter((b) => b.triangleCount > 0).map((b) => b.part());
  return { parts, anchors: [] };
}

// ---------- granary ----------

/** A staddle stone standing at `foot`: a tapering post under a round cap like a mushroom's, so nothing climbs from the ground into the store. */
function staddle(b: PartBuilder, foot: V3, ch: Channels, r: Rand): void {
  const square = (y: number, h: number): V3[] => [[-h, -h], [h, -h], [h, h], [-h, h]].map(([dx, dz]) => [foot[0] + (dx as number), y, foot[2] + (dz as number)] as V3);
  const lo = square(-0.25, 0.17);
  const hi = square(0.5, 0.1);
  for (let k = 0; k < 4; k++) {
    const a = lo[k] as V3;
    const c = lo[(k + 1) % 4] as V3;
    const n = normalize([(a[0] + c[0]) / 2 - foot[0], 0.12, (a[2] + c[2]) / 2 - foot[2]]);
    quad(b, [a, c, hi[(k + 1) % 4] as V3, hi[k] as V3], n, 0.42 + 0.1 * r.next(), ch);
  }
  const sides = 10;
  const cap = (a: number, rad: number, y: number): V3 => [foot[0] + Math.cos(a) * rad, y, foot[2] + Math.sin(a) * rad];
  const crown: V3 = [foot[0], 0.66, foot[2]];
  const turn = r.next();
  for (let k = 0; k < sides; k++) {
    const a0 = ((k + turn) / sides) * TAU;
    const a1 = ((k + 1 + turn) / sides) * TAU;
    const am = (a0 + a1) / 2;
    const out: V3 = [Math.cos(am), 0, Math.sin(am)];
    quad(b, [cap(a0, 0.27, 0.5), cap(a1, 0.27, 0.5), cap(a1, 0.28, 0.6), cap(a0, 0.28, 0.6)], out, 0.5, ch);
    tri(b, [cap(a0, 0.28, 0.6), cap(a1, 0.28, 0.6), crown], normalize(addScaled(UP, out, 0.3)), 0.62, ch);
    tri(b, [cap(a1, 0.27, 0.5), cap(a0, 0.27, 0.5), [foot[0], 0.5, foot[2]]], [0, -1, 0], 0.25, ch);
  }
}

export function buildGranary(p: Resolved<typeof granaryParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("granary");
  const L = p.size;
  const W = clamp(L * 0.72, 1.5, 2.1);
  const Y = yard(plan, 1.6 + W / 2, -plan.depth * 0.12);
  const [X, , Z] = Y.axes;
  const side = featureSide(plan);
  const stone = new PartBuilder("masonry", "solid");
  const wood = new PartBuilder("timber", "solid");
  const paint = new PartBuilder("trim", "solid");
  const roof = new PartBuilder("roof", "solid");
  const weed = new PartBuilder("leaf");
  const seed = Math.floor(r.next() * 1e6);

  // Staddle stones in two rows; the outer row topples as the store fails, and the store slumps over onto its side.
  const rowX = W / 2 - 0.22;
  const across = L > 2.6 ? 4 : 3;
  const zs = Array.from({ length: across }, (_, k) => -(L / 2 - 0.22) + ((L - 0.44) * k) / (across - 1));
  for (const sx of [-1, 1]) {
    for (const z of zs) {
      const foot = Y.at(sx * rowX, 0, z);
      staddle(stone, foot, still(foot, 0.35 + 0.3 * r.next(), { tint: (r.next() - 0.5) * 0.05, ...(sx > 0 ? { fall: [0, 0, -side * 1.4, 0.24] as const } : {}) }), r);
    }
  }
  const hinge = Y.at(-rowX, 0.62, 0);
  const body = (wither: number, extra: Partial<Channels> = {}): Channels => ({ loss: 0, droop: 0, wither, glow: 0, pivot: hinge, fall: [0, 0, -side * 0.38, 0.2], ...extra });
  for (const sx of [-1, 1]) box(wood, Y.at(sx * rowX, 0.69, 0), Y.axes, [0.08, 0.07, L / 2 + 0.05], 0.4, body(0.55));
  for (const z of zs) box(wood, Y.at(0, 0.81, z), Y.axes, [W / 2, 0.05, 0.06], 0.4, body(0.55));
  box(wood, Y.at(0, 0.89, 0), Y.axes, [W / 2 + 0.03, 0.03, L / 2 + 0.03], 0.45, body(0.55));

  // Walls of lapped weatherboards that rot through from the top, painted corner boards, and a plank door facing out.
  const floor = 0.92;
  const eave = floor + 1.45;
  const doorHalf = 0.36;
  const doorTop = floor + 1.15;
  const rows = 7;
  const rowH = (eave - floor) / rows;
  const boardRot = (q: V3): number => clamp(0.25 + 0.42 * ((q[1] - floor) / (eave - floor)) + 0.3 * fbm3(q[0] * 1.3, q[1] * 1.3, q[2] * 1.3, seed, 2), 0, 1);
  const faces = [
    { n: X, u: Z, half: L / 2, out: W / 2, door: true },
    { n: scale(X, -1), u: Z, half: L / 2, out: W / 2, door: false },
    { n: Z, u: X, half: W / 2, out: L / 2, door: false },
    { n: scale(Z, -1), u: X, half: W / 2, out: L / 2, door: false },
  ];
  const center = Y.at(0, 0, 0);
  for (const f of faces) {
    for (let j = 0; j < rows; j++) {
      const y = floor + rowH * (j + 0.5);
      const runs: [number, number][] = f.door && y - rowH / 2 < doorTop ? [[-f.half - 0.02, -doorHalf - 0.06], [doorHalf + 0.06, f.half + 0.02]] : [[-f.half - 0.02, f.half + 0.02]];
      for (const [s0, s1] of runs) {
        const c = addScaled(addScaled(addScaled(center, f.n, f.out + 0.018 + 0.006 * (j % 2)), f.u, (s0 + s1) / 2), UP, y);
        box(wood, c, [f.u, UP, f.n], [(s1 - s0) / 2, rowH / 2 + 0.012, 0.016], 0.46 + 0.07 * (j % 2) + 0.04 * r.next(), body(0.6, { rot: boardRot(c) }));
      }
    }
    // Its dark inside, which shows where the boards have rotted through.
    const inside = (s: number, y: number): V3 => addScaled(addScaled(addScaled(center, f.n, f.out - 0.03), f.u, s), UP, y);
    quad(wood, [inside(-f.half, floor), inside(f.half, floor), inside(f.half, eave), inside(-f.half, eave)], scale(f.n, -1), 0.04, body(0.3));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(paint, Y.at(sx * (W / 2 + 0.03), (floor + eave) / 2, sz * (L / 2 + 0.03)), Y.axes, [0.06, (eave - floor) / 2 + 0.02, 0.06], 0.55, body(0.6, { rot: 0.4 }));
  }
  for (let k = 0; k < 3; k++) {
    const z = -doorHalf + ((k + 0.5) / 3) * doorHalf * 2;
    box(wood, Y.at(W / 2 + 0.01, (floor + doorTop) / 2, z), [Z, UP, X], [doorHalf / 3 - 0.008, (doorTop - floor) / 2, 0.02], 0.32 + 0.06 * r.next(), body(0.6, { rot: 0.5 }));
  }
  for (const sz of [-1, 1]) box(paint, Y.at(W / 2 + 0.04, (floor + doorTop) / 2 + 0.03, sz * (doorHalf + 0.03)), Y.axes, [0.025, (doorTop - floor) / 2 + 0.03, 0.04], 0.55, body(0.6));
  box(paint, Y.at(W / 2 + 0.04, doorTop + 0.06, 0), Y.axes, [0.025, 0.04, doorHalf + 0.08], 0.58, body(0.6));
  // Stone steps up toward the door, stopping short of it so rats cannot climb in.
  for (let k = 0; k < 3; k++) {
    const top = 0.62 - k * 0.2;
    const c = Y.at(W / 2 + 0.32 + 0.3 * k, (top - 0.35) / 2, 0);
    box(stone, c, Y.axes, [0.15, (top + 0.35) / 2, 0.42], 0.5 + 0.1 * r.next(), still(c, 0.45));
  }

  // The roof, gabled or hipped, rotting through and sagging; boarded gables under a gabled one.
  const over = 0.28;
  const verge = 0.22;
  const rise = (W / 2 + over) * 0.95;
  const ridgeY = eave - 0.08 + rise;
  const covering = (q: V3): Channels => body(0.6, { droop: 0.04, rot: clamp(0.3 + 0.35 * r.next() + 0.2 * (ridgeY - q[1]), 0, 1) });
  const ex = W / 2 + over;
  const ey = eave - 0.08;
  if (p.roof === "hipped") {
    const half = Math.max(0, L / 2 - W / 2);
    const ez = L / 2 + over;
    for (const s of [-1, 1]) {
      slope(roof, Y.at(s * ex, ey, -ez), Y.at(s * ex, ey, ez), Y.at(0, ridgeY, half), Y.at(0, ridgeY, -half), 4, Y.dir(s, 1, 0), covering, r);
      slope(roof, Y.at(-ex, ey, s * ez), Y.at(ex, ey, s * ez), Y.at(0, ridgeY, s * half), Y.at(0, ridgeY, s * half), 4, Y.dir(0, 1, s), covering, r);
    }
    if (half > 0.05) box(roof, Y.at(0, ridgeY + 0.03, 0), [Z, UP, X], [half + 0.04, 0.05, 0.09], 0.5, body(0.6));
  } else {
    const ez = L / 2 + verge;
    for (const s of [-1, 1]) {
      slope(roof, Y.at(s * ex, ey, -ez), Y.at(s * ex, ey, ez), Y.at(0, ridgeY, ez), Y.at(0, ridgeY, -ez), 4, Y.dir(s, 1, 0), covering, r);
      for (const z of [-ez, ez]) beam(wood, Y.at(0, ridgeY + 0.03, z), Y.at(s * (ex + 0.04), ey - 0.03, z), 0.14, 0.035, Z, 0.45, body(0.55, { droop: 0.04 }));
    }
    box(roof, Y.at(0, ridgeY + 0.03, 0), [Z, UP, X], [ez + 0.03, 0.05, 0.09], 0.5, body(0.6));
    for (const sz of [-1, 1]) {
      for (let y = eave; y < ridgeY - 0.12; y += rowH) {
        const h = Math.min(rowH, ridgeY - 0.12 - y);
        const reach = (W / 2 + 0.02) * (1 - (y + h / 2 - ey) / (ridgeY - ey));
        if (reach < 0.06) continue;
        const c = Y.at(0, y + h / 2, sz * (L / 2 + 0.018));
        box(wood, c, Y.axes, [reach, h / 2 + 0.01, 0.016], 0.48 + 0.05 * r.next(), body(0.6, { rot: boardRot(c) }));
      }
    }
  }
  weedsAbout(weed, Y, 0.2, Math.max(W, L) / 2 + 0.7, 14, r.fork("weeds"));
  const parts = [stone, wood, paint, roof, weed].filter((b) => b.triangleCount > 0).map((b) => b.part());
  return { parts, anchors: [] };
}
