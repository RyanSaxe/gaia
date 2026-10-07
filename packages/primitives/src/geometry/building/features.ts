// A building's feature: what sets it apart and says what it does. A
// waterwheel turns beside a mill and slows to a stop as it fails; a tower
// rises from the corner of an archive, its windows lamplit at night, and
// crumbles from the top down. Each builds against the house's plan, on the
// side the chimney leaves free, so the two never meet.

import type { BuildContext, BuildingPlan, Built, Mass, Opening, Resolved, Vec3 } from "@gaia/schema";
import type { towerParams, waterwheelParams } from "../../structure.ts";
import { type Channels, PartBuilder, type V3, add, addScaled, clamp, fbm3, lossThreshold, normalize } from "../kit.ts";
import { UP, beam, box, log, quad, tri } from "../blocks.ts";
import { chimneyEnd, on, ruinAt, ruinOf, still, wallRot, wallTop, wallsOf } from "./frame.ts";
import { ivy, rubble, wallSheet } from "./ruin.ts";

/** Builds into another builder, every vertex and pivot moved by `off`: a feature's own frame placed beside the house. */
class Moved extends PartBuilder {
  constructor(
    swatch: string,
    collision: "solid" | "walkable" | "none",
    readonly off: Vec3,
  ) {
    super(swatch, collision);
  }

  override vertex(p: Vec3, n: Vec3, shade: number, c: Channels, cut?: Vec3): number {
    return super.vertex(add(p, this.off), n, shade, { ...c, pivot: add(c.pivot, this.off) }, cut);
  }
}

/** The side wall (+1 or -1 along x) a feature takes: away from a gable chimney. */
const featureSide = (plan: BuildingPlan): 1 | -1 => (plan.masses[0]?.ridge === "x" ? (chimneyEnd(plan) === 1 ? -1 : 1) : 1);

// ---------- waterwheel ----------

export function buildWaterwheel(p: Resolved<typeof waterwheelParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("waterwheel");
  const wood = new PartBuilder("timber", "solid");
  const stone = new PartBuilder("masonry", "solid");
  const side = featureSide(plan);
  const R = p.wheel;
  const W = 0.62 + 0.12 * R;
  const sink = 0.42;
  const cx = side * (plan.width / 2 + 0.38 + W / 2);
  const cz = plan.masses[0]?.ridge === "x" ? -0.15 : -plan.depth * 0.12;
  const cy = R - sink;
  const center: V3 = [cx, cy, cz];
  const rate = p.drive === "overshot" ? 0.11 : -0.09;
  const spin: Vec3 = [rate, 0, 0];
  const on3 = (x: number, angle: number, radius: number): V3 => [cx + x, cy + Math.sin(angle) * radius, cz + Math.cos(angle) * radius];
  /** Every piece of the wheel turns about the axle; some are lost as it fails. */
  const turning = (wither: number, lost: number, top = 0.4): Channels => ({ loss: r.next() < lost ? lossThreshold(r.next(), top, 0.04) : 0, droop: 0, wither, glow: 0, pivot: center, tint: (r.next() - 0.5) * 0.04, spin });

  // Two rims of short beams, spokes from the hub, and paddles between the rims.
  const segments = 22;
  for (const x of [-W / 2, W / 2]) {
    for (let k = 0; k < segments; k++) {
      const a0 = (k / segments) * Math.PI * 2;
      const a1 = ((k + 1) / segments) * Math.PI * 2;
      beam(wood, on3(x, a0, R), on3(x, a1, R), 0.14, 0.08, [1, 0, 0], 0.42 + 0.08 * r.next(), turning(0.55, 0.12, 0.2));
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      beam(wood, on3(x, a, 0.2), on3(x, a, R - 0.05), 0.1, 0.07, [1, 0, 0], 0.45, turning(0.5, 0.15, 0.18));
    }
  }
  const paddles = Math.round(14 + 4 * R);
  for (let k = 0; k < paddles; k++) {
    const a = (k / paddles) * Math.PI * 2;
    // Buckets lean back against the turn on an overshot wheel; paddles stand straight out on an undershot one.
    const lean = p.drive === "overshot" ? 0.45 : 0;
    const inner = on3(0, a, R - 0.36);
    const outer = on3(0, a + lean * 0.35, R + 0.02);
    const radial = normalize([0, outer[1] - inner[1], outer[2] - inner[2]]);
    const mid: V3 = [cx, (inner[1] + outer[1]) / 2, (inner[2] + outer[2]) / 2];
    const len = Math.hypot(outer[1] - inner[1], outer[2] - inner[2]);
    const across = normalize([0, -radial[2], radial[1]]);
    box(wood, mid, [[1, 0, 0], radial, across], [W / 2 + 0.03, len / 2, 0.025], 0.5 + 0.1 * r.next(), turning(0.6, 0.55, 0.45));
  }
  log(wood, [cx - W / 2 - 0.08, cy, cz], [cx + W / 2 + 0.08, cy, cz], 0.2, 0.4, turning(0.5, 0), 8);
  // The axle runs into the wall on one side and onto a stone pier on the other.
  const still0 = (c: Vec3, wither: number): Channels => still(c, wither, { tint: (r.next() - 0.5) * 0.04 });
  log(wood, [side * (plan.width / 2 - 0.05), cy, cz], [cx + side * (W / 2 + 0.55), cy, cz], 0.08, 0.35, still0(center, 0.5), 6);
  const pierX = cx + side * (W / 2 + 0.42);
  for (let k = 0, y = -0.6; y < cy - 0.1; k++) {
    const h = Math.min(0.38, cy - 0.1 - y);
    const c: V3 = [pierX + (r.next() - 0.5) * 0.04, y + h / 2, cz];
    box(stone, c, [[1, 0, 0], UP, [0, 0, 1]], [0.24 + 0.03 * r.next(), h / 2 - 0.01, 0.3 + 0.03 * r.next()], 0.45 + 0.2 * r.next(), still0(c, 0.45));
    y += h;
    if (k > 20) break;
  }
  box(stone, [pierX, cy - 0.04, cz], [[1, 0, 0], UP, [0, 0, 1]], [0.3, 0.07, 0.36], 0.62, still0([pierX, cy, cz], 0.45));
  // A stone-lined pit the wheel turns in, low walls either side.
  for (const x of [cx - W / 2 - 0.2, cx + W / 2 + 0.2]) {
    if (Math.abs(x) < plan.width / 2 + 0.05) continue;
    for (let s = -R * 0.85; s < R * 0.85; ) {
      const len = 0.42 + 0.25 * r.next();
      for (const [y, h] of [[-0.35, 0.3], [0.0, 0.26]] as const) {
        const c: V3 = [x, y + h / 2, cz + s + len / 2];
        box(stone, c, [[1, 0, 0], UP, [0, 0, 1]], [0.15, h / 2, len / 2 - 0.01], 0.42 + 0.2 * r.next(), still0(c, 0.5));
      }
      s += len;
    }
  }

  // An overshot wheel is fed by a wooden flume on trestles, from behind the house to just past the wheel's top.
  if (p.drive === "overshot") {
    const y = cy + R + 0.22;
    const z0 = -plan.depth / 2 - 2.4;
    const z1 = cz + 0.25;
    const rear: V3 = [cx, y, z0];
    const steps = Math.max(2, Math.round((z1 - z0) / 1.3));
    for (let k = 0; k < steps; k++) {
      const a = z0 + ((z1 - z0) * k) / steps;
      const b = z0 + ((z1 - z0) * (k + 1)) / steps;
      const mid: V3 = [cx, y, (a + b) / 2];
      const ch: Channels = { loss: 0, droop: 0.12, wither: 0.65, glow: 0, pivot: rear, tint: (r.next() - 0.5) * 0.03, rot: 0.55 };
      box(wood, mid, [[1, 0, 0], UP, [0, 0, 1]], [W * 0.42, 0.03, (b - a) / 2 + 0.01], 0.48, ch);
      for (const sx of [-1, 1]) box(wood, [cx + sx * W * 0.42, y + 0.14, (a + b) / 2], [[1, 0, 0], UP, [0, 0, 1]], [0.03, 0.15, (b - a) / 2 + 0.01], 0.44, ch);
    }
    // Trestles behind the wheel; they lean as the mill fails.
    for (let z = z0 + 0.3; z < cz - R - 0.2; z += 1.4) {
      for (const sx of [-1, 1]) {
        const base: V3 = [cx + sx * W * 0.45, -0.3, z];
        const tip = sx * (0.12 + 0.2 * r.next());
        beam(wood, base, [cx + sx * W * 0.4, y - 0.04, z], 0.1, 0.1, [0, 0, 1], 0.42, { loss: 0, droop: 0, wither: 0.6, glow: 0, pivot: base, fall: [0, 0, tip, 0.34] });
      }
      beam(wood, [cx - W * 0.5, y - 0.06, z], [cx + W * 0.5, y - 0.06, z], 0.1, 0.1, [0, 0, 1], 0.44, still0([cx, y, z], 0.55));
    }
  }

  const parts = [wood.part(), stone.part()];
  return { parts, anchors: [] };
}

// ---------- tower ----------

/** One face of a pyramid cap from the eave square up to the apex, in courses that rot through. */
function capFace(b: PartBuilder, corners: readonly [V3, V3], apex: V3, rows: number, rotAt: (q: V3) => number, pivot: V3): void {
  const [a, c] = corners;
  const n = normalize(cross3(sub3(c, a), sub3(apex, a)));
  for (let j = 0; j < rows; j++) {
    const t0 = j / rows;
    const t1 = (j + 1) / rows;
    const p0 = lerp3(a, apex, t0);
    const p1 = lerp3(c, apex, t0);
    const q0 = lerp3(a, apex, t1);
    const q1 = lerp3(c, apex, t1);
    // Each course laps a little over the one below.
    const lip = addScaled([0, 0, 0], n, 0.035);
    const ch = (q: V3): Channels => ({ loss: 0, droop: 0.05, wither: 0.6, glow: 0, pivot, rot: rotAt(q) });
    if (j === rows - 1) tri(b, [add(p0, lip), add(p1, lip), apex], n, 0.55, ch(p0));
    else {
      const i0 = b.vertex(add(p0, lip), n, 0.5 + 0.05 * (j % 2), ch(p0));
      const i1 = b.vertex(add(p1, lip), n, 0.5 + 0.05 * (j % 2), ch(p1));
      const i2 = b.vertex(q1, n, 0.58, ch(q1));
      const i3 = b.vertex(q0, n, 0.58, ch(q0));
      b.triangle(i0, i1, i2);
      b.triangle(i0, i2, i3);
    }
  }
}

const sub3 = (a: Vec3, b: Vec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Vec3, b: Vec3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a: Vec3, b: Vec3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function buildTower(p: Resolved<typeof towerParams>, ctx: BuildContext, plan: BuildingPlan): Built {
  const r = ctx.rand.fork("tower");
  const side = featureSide(plan);
  const T = clamp(Math.min(plan.width, plan.depth) * 0.62, 3, 3.8);
  const houseTop = Math.max(...plan.masses.map((m) => wallTop(plan, m) + m.rise));
  const H = clamp(houseTop + p.height + 2.5 * (ctx.facts.reach ?? 0.5), 8, 19);
  // At the back corner on the free side, joined to the house a little, clear of its windows.
  const off: V3 = [side * (plan.width / 2 + T / 2 - 0.35), 0, -plan.depth / 2 - T / 2 + 1.05];
  const render = new Moved("wall", "solid", off);
  const stone = new Moved("masonry", "solid", off);
  const glass = new Moved("glass", "none", off);
  const roof = new Moved("roof", "solid", off);
  const wood = new Moved("timber", "solid", off);
  const moss = new Moved("moss", "none", off);
  const storey = 2.7;
  const windows: Opening[] = [];
  const body: Mass = { x: 0, z: 0, width: T, depth: T, round: false, wallHeight: H - plan.floor, storeys: 1, rise: 0, ridge: "x", roof: "hip", fall: 1, ends: [true, true] };
  const tower0: BuildingPlan = { width: T, depth: T, floor: plan.floor, footing: 1.4, masses: [body], settle: plan.settle, openings: [] };
  const faces = wallsOf(tower0);
  for (let y = plan.floor + 1.0; y + 1.3 < H - 0.5; y += storey) {
    for (const w of faces) {
      // Windows look away from the house, and every way once above its roof.
      const outward = w.n[0] * side > 0.5 || w.n[2] < -0.5 || y > houseTop - 0.5;
      if (outward) windows.push({ kind: "window", mass: 0, position: on(w, w.length / 2, y), normal: w.n, width: 0.52, height: 1.15 });
    }
  }
  const tower: BuildingPlan = { ...tower0, openings: windows };
  const ruin = ruinOf(tower);
  const seed = Math.floor(r.next() * 1e6);

  // Rendered walls in hand-laid cells, rotting through from the top as the archive fails.
  for (const w of faces) {
    const pivot = on(w, w.length / 2, H / 2);
    wallSheet(render, tower, w, -tower.footing, 0.01, 0.7, (q) => {
      const n = fbm3(q[0] * 1.4, q[1] * 1.4, q[2] * 1.4, seed, 2);
      const up = clamp(q[1] / H, 0, 1);
      return { shade: 0.56 + 0.1 * n, c: still(pivot, 0.55 + 0.2 * up, { rot: clamp(wallRot(tower, body, ruin, q) * 0.7 + 0.35 * up * up, 0, 1), tint: 0.02 * n }) };
    });
  }
  // Quoins up every corner, and a string course at every storey; the top courses fall first.
  for (const w of faces) {
    for (let y = -0.3, k = 0; y < H - 0.05; k++) {
      const h = Math.min(0.36, H - y);
      const long = k % 2 === 0;
      const c = on(w, (long ? 0.36 : 0.24) - 0.02, y + h / 2, 0.04);
      const up = y / H;
      box(stone, c, [w.u, UP, w.n], [long ? 0.38 : 0.26, h / 2 - 0.012, 0.06], 0.52 + 0.14 * r.next(), still(c, 0.45, { loss: up > 0.6 && r.next() < 0.7 ? lossThreshold(r.next(), 0.1 + 0.35 * (up - 0.6) * 2.5, 0.04) : 0, tint: (r.next() - 0.5) * 0.04 }));
      y += h;
    }
    for (let y = plan.floor + storey - 0.35; y < H - 0.6; y += storey) {
      const c = on(w, w.length / 2, y, 0.05);
      box(stone, c, [w.u, UP, w.n], [w.length / 2 + 0.06, 0.07, 0.07], 0.6, still(c, 0.45, { loss: y / H > 0.65 ? lossThreshold(r.next(), 0.22, 0.05) : 0 }));
    }
    const top = on(w, w.length / 2, H - 0.1, 0.07);
    box(stone, top, [w.u, UP, w.n], [w.length / 2 + 0.12, 0.12, 0.1], 0.6, still(top, 0.45, { loss: lossThreshold(r.next(), 0.25, 0.08) }));
  }
  // Tall, narrow windows, lamplit at night: one goes dark at a time as the archive fails.
  for (const o of windows) {
    const w = faces.find((f) => f.n[0] === o.normal[0] && f.n[2] === o.normal[2]);
    if (w === undefined) continue;
    const s = w.length / 2;
    const y = o.position[1];
    const hw = o.width / 2;
    const at = (ds: number, dy: number, d: number): V3 => on(w, s + ds, y + dy, d);
    const pivot = at(0, o.height / 2, 0);
    quad(glass, [at(-hw, 0, -0.02), at(hw, 0, -0.02), at(hw, o.height, -0.02), at(-hw, o.height, -0.02)], w.n, 0.2, still(pivot, 1, { rot: 0.8 }));
    const lit: Channels = { loss: lossThreshold(r.next(), 0.68, 0.22), droop: 0, wither: 0.25, glow: 0.75 + 0.25 * r.next(), pivot };
    quad(glass, [at(-hw, 0, -0.01), at(hw, 0, -0.01), at(hw, o.height, -0.01), at(-hw, o.height, -0.01)], w.n, [0.55, 0.55, 0.85, 0.85], lit);
    const axes = [w.u, UP, w.n] as const;
    const surround = (c: V3, half: Vec3): void => box(stone, c, axes, half, 0.62, still(c, 0.45));
    surround(at(0, -0.07, 0.06), [hw + 0.16, 0.07, 0.1]);
    for (const sx of [-1, 1]) surround(at(sx * (hw + 0.08), o.height / 2, 0.05), [0.08, o.height / 2 + 0.02, 0.07]);
    // A round head of five voussoirs.
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI;
      const a1 = ((k + 1) / 5) * Math.PI;
      const R = hw + 0.08;
      beam(stone, at(Math.cos(a0) * R, o.height + Math.sin(a0) * R * 0.7, 0.06), at(Math.cos(a1) * R, o.height + Math.sin(a1) * R * 0.7, 0.06), 0.15, 0.14, w.n, 0.6, still(pivot, 0.45));
    }
    // A shadowed reveal fills the round head behind the voussoirs.
    const head: V3[] = [];
    for (let k = 0; k <= 6; k++) head.push(at(Math.cos((k / 6) * Math.PI) * hw, o.height + Math.sin((k / 6) * Math.PI) * hw * 0.7, -0.015));
    for (let k = 0; k < 6; k++) tri(glass, [at(0, o.height, -0.015), head[k] as V3, head[k + 1] as V3], w.n, 0.15, still(pivot, 1));
  }
  // The roof of the tower: a ceiling over its top, then the chosen cap.
  const eave = T / 2 + 0.32;
  const ring: V3[] = [[-eave, H, eave], [eave, H, eave], [eave, H, -eave], [-eave, H, -eave]];
  const capPivot: V3 = [0, H, 0];
  quad(roof, [ring[0] as V3, ring[3] as V3, ring[2] as V3, ring[1] as V3], [0, -1, 0], 0.25, still(capPivot, 0.6));
  const capRot = (q: V3): number => clamp(0.35 + 0.5 * (1 - (q[1] - H) / (T * 0.9)) + 0.3 * ruinAt(ruin, q), 0, 1);
  let apex: V3;
  if (p.cap === "lantern") {
    // An open lantern room: four posts round a lamp that burns at night, under a small steep cap.
    const lh = 1.7;
    const post = T / 2 - 0.2;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const base: V3 = [x * post, H, z * post];
      const tip = 0.5 + 0.4 * r.next();
      beam(wood, base, [x * post, H + lh, z * post], 0.16, 0.16, [1, 0, 0], 0.42, { loss: 0, droop: 0, wither: 0.55, glow: 0, pivot: base, fall: [z * tip, 0, -x * tip, 0.18 + 0.12 * r.next()] });
    }
    for (const y of [H + 0.55, H + lh - 0.05]) {
      for (const [a, b2] of [[[-post, -post], [post, -post]], [[post, -post], [post, post]], [[post, post], [-post, post]], [[-post, post], [-post, -post]]] as const) {
        beam(wood, [a[0], y, a[1]], [b2[0], y, b2[1]], 0.08, 0.08, UP, 0.45, still([0, y, 0], 0.55, { loss: lossThreshold(r.next(), 0.2, 0.05) }));
      }
    }
    const lampC: V3 = [0, H + 0.75, 0];
    box(glass, lampC, [[1, 0, 0], UP, [0, 0, 1]], [0.32, 0.45, 0.32], 0.85, { loss: lossThreshold(r.next(), 0.5, 0.3), droop: 0, wither: 0.4, glow: 1, pivot: lampC });
    box(wood, [0, H + 0.26, 0], [[1, 0, 0], UP, [0, 0, 1]], [0.42, 0.05, 0.42], 0.4, still(lampC, 0.5));
    const top = H + lh;
    const cap: V3[] = [[-eave + 0.15, top, eave - 0.15], [eave - 0.15, top, eave - 0.15], [eave - 0.15, top, -eave + 0.15], [-eave + 0.15, top, -eave + 0.15]];
    apex = [0, top + T * 0.75, 0];
    quad(roof, [cap[0] as V3, cap[3] as V3, cap[2] as V3, cap[1] as V3], [0, -1, 0], 0.25, still(capPivot, 0.6));
    for (let k = 0; k < 4; k++) capFace(roof, [cap[k] as V3, cap[(k + 1) % 4] as V3], apex, 4, capRot, capPivot);
  } else {
    apex = [0, H + T * 0.95, 0];
    for (let k = 0; k < 4; k++) capFace(roof, [ring[k] as V3, ring[(k + 1) % 4] as V3], apex, 6, capRot, capPivot);
  }
  // A finial, which leans and falls as the archive fails.
  const tip = 1.2 + 0.3 * r.next();
  const finial: Channels = { loss: 0, droop: 0, wither: 0.5, glow: 0, pivot: apex, fall: [tip * 0.7, 0, tip * 0.7, 0.28] };
  log(wood, addScaled(apex, UP, -0.1), addScaled(apex, UP, 0.75), 0.045, 0.45, finial, 6);
  box(wood, addScaled(apex, UP, 0.8), [[1, 0, 0], UP, [0, 0, 1]], [0.08, 0.08, 0.08], 0.5, finial);

  ivy(moss, tower, ruin, r.fork("ivy"));
  rubble(stone, tower, ruin, r.fork("rubble"), 0.24, 22);
  const parts = [render, stone, glass, roof, wood, moss].filter((b) => b.triangleCount > 0).map((b) => b.part());
  return { parts, anchors: [] };
}
