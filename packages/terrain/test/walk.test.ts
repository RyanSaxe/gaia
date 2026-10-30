import { describe, expect, it } from "vitest";
import { type BuildingPlan, type Built, Library, type Part, blueprintOf, rand, seedOf } from "@gaia/schema";
import { BIOME_PRIMITIVES, FLORA_PRIMITIVES, LANDMARK_PRIMITIVES, RELIEF_PRIMITIVES, STRUCTURE_PRIMITIVES } from "@gaia/primitives";
import { landmark, structure } from "@gaia/kinds";
import { realize } from "@gaia/realize";
import { randomSlots } from "@gaia/world/testing";
import {
  BODY_BAND,
  BODY_RADIUS,
  type Deck,
  type Floor,
  EYE_HEIGHT,
  type Stride,
  NO_SOLIDS,
  SWIM,
  type SolidShape,
  type Solids,
  type Terrain,
  TRAVEL,
  WALK_TO,
  type Walker,
  bakeTerrain,
  carry,
  floorOf,
  groundHeightAt,
  landHalf,
  clearanceAt,
  deckAt,
  extentOf,
  footingAt,
  fordBeside,
  heightAt,
  outlineShape,
  piecesShapes,
  planWalk,
  solidsOf,
  stanceAt,
  standAt,
  stride,
  siteToWorld,
  wallsShape,
  wadeSpeed,
  walkStep,
  waterDepthAt,
  wayAhead,
} from "@gaia/terrain";
import { sampleWorld } from "@gaia/terrain/testing";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const t: Terrain = bakeTerrain(sampleWorld(), lib);
const pond = t.ponds[0]!;
const dt = 1 / 60;
const hold = (solids: Solids, from: Walker, dx: number, dz: number, steps: number, speed = WALK_TO.pace): Walker[] => {
  const path = [from];
  for (let i = 0; i < steps; i++) path.push(walkStep(t, solids, path[path.length - 1]!, { dx, dz, speed }, dt));
  return path;
};
/** Steps a tapped walk until it ends, for at most two minutes. Each step aims for the point a little ahead along the way, at its pace. */
const tapWalk = (solids: Solids, from: Walker, to: Walker) => {
  // Move one walker in place, as the lab does, so a way must not depend on the walker it was planned from.
  const at = { x: from.x, z: from.z };
  let walk = planWalk(t, solids, at, to);
  const path: Walker[] = [{ ...at }];
  for (let i = 0; i < 7200; i++) {
    const heading = wayAhead(walk, at);
    walk = heading.walk;
    if (heading.remaining <= WALK_TO.reach) return { state: "arrived" as const, at: { ...at }, path, walk, seconds: i * dt };
    const next = walkStep(t, solids, at, { dx: heading.aim.x - at.x, dz: heading.aim.z - at.z, speed: heading.pace }, dt);
    if (Math.hypot(next.x - at.x, next.z - at.z) < WALK_TO.stall * heading.pace * dt) return { state: "stalled" as const, at: { ...at }, path, walk, seconds: i * dt };
    path.push({ ...next });
    at.x = next.x;
    at.z = next.z;
  }
  return { state: "walking" as const, at: { ...at }, path, walk, seconds: 120 };
};
// The sample world's pond lies near its east edge, so the dry ground to walk on is west of it.
const dry = { x: pond.x - pond.reach * 2.5, z: pond.z };

describe("wading and swimming", () => {
  it("slows as the water deepens, swims slower still, and is never stopped by water", () => {
    expect(wadeSpeed(0)).toBe(1);
    for (let d = 0; d < 4; d += 0.05) {
      expect(wadeSpeed(d + 0.05)).toBeLessThanOrEqual(wadeSpeed(d));
      expect(wadeSpeed(d + 0.05)).toBeGreaterThan(0);
    }
    // Anywhere in the pond, a step in any direction moves the walker its full wading or swimming stride.
    for (let r = 0; r < pond.reach; r += 3) {
      for (let a = 0; a < 8; a++) {
        const at = { x: pond.x + r * 0.7, z: pond.z + r * 0.7 };
        const ang = (a / 8) * Math.PI * 2;
        const next = walkStep(t, NO_SOLIDS, at, { dx: Math.cos(ang), dz: Math.sin(ang), speed: 4 }, 0.1);
        expect(Math.hypot(next.x - at.x, next.z - at.z)).toBeCloseTo(4 * 0.1 * wadeSpeed(waterDepthAt(t, at.x, at.z)), 6);
      }
    }
    // Held keys move the walker across the deep center and out the far side.
    const path = hold(NO_SOLIDS, dry, 1, 0, 60 * 90);
    const far = path.findIndex((p) => p.x > pond.x + pond.reach * 1.2);
    expect(far).toBeGreaterThan(0);
    expect(path.slice(0, far).some((p) => waterDepthAt(t, p.x, p.z) > SWIM.to)).toBe(true);
    // A tapped walk crosses the pond all the way, swimming its deep middle.
    const walk = tapWalk(NO_SOLIDS, { x: pond.x - pond.reach * 1.6, z: pond.z }, { x: pond.x + pond.reach * 1.6, z: pond.z });
    expect(walk.state).toBe("arrived");
    expect(walk.path.some((p) => stanceAt(t, p.x, p.z).swim === 1)).toBe(true);
  });

  it("keeps the eyes above the surface, easing them smoothly down to swim and back up the bank", () => {
    const path = hold(NO_SOLIDS, dry, 1, 0, 60 * 90).filter((p) => p.x < pond.x + pond.reach * 1.5);
    const stream = t.streams[0]!.stations;
    const mid = stream[Math.floor(stream.length / 2)]!;
    const next = stream[Math.floor(stream.length / 2) + 1]!;
    const across = { x: -(next.z - mid.z), z: next.x - mid.x };
    const len = Math.hypot(across.x, across.z);
    // Out of a stream and up its bank.
    const bank = hold(NO_SOLIDS, { x: mid.x - (across.x / len) * 8, z: mid.z - (across.z / len) * 8 }, across.x / len, across.z / len, 60 * 5);
    let swam = 0;
    for (const walk of [path, bank]) {
      for (let i = 0; i < walk.length; i++) {
        const p = walk[i]!;
        const s = stanceAt(t, p.x, p.z);
        const ground = heightAt(t.lattice, p.x, p.z);
        if (s.depth === 0) expect(s.eye).toBeCloseTo(ground + EYE_HEIGHT, 6);
        expect(s.eye).toBeGreaterThanOrEqual(ground + s.depth + SWIM.eye - 1e-6);
        if (s.depth > EYE_HEIGHT - SWIM.eye + SWIM.ease) expect(s.eye).toBeCloseTo(ground + s.depth + SWIM.eye, 6);
        swam = Math.max(swam, s.swim);
        if (i === 0) continue;
        const q = walk[i - 1]!;
        const moved = Math.hypot(p.x - q.x, p.z - q.z);
        // The eyes never jump. They rise and fall no faster than the steepest bank the relief budget allows.
        expect(Math.abs(s.eye - stanceAt(t, q.x, q.z).eye)).toBeLessThanOrEqual(moved * 0.9 + 1e-6);
      }
    }
    expect(swam).toBe(1);
    // In the pond's deep center the eyes are just above the surface.
    const deep = stanceAt(t, pond.x, pond.z);
    expect(deep.eye - heightAt(t.lattice, pond.x, pond.z) - deep.depth).toBeCloseTo(SWIM.eye, 6);
  });
});

describe("solids", () => {
  // A trunk, a lumpy rock measured in 48 directions, and a house's walls, on dry ground.
  const trunk = { x: dry.x - 10, z: dry.z, radius: 0.55 };
  const lumps = Float32Array.from({ length: 48 }, (_, k) => 1.1 + 0.35 * Math.sin((k / 48) * Math.PI * 6) + 0.2 * Math.cos((k / 48) * Math.PI * 10));
  const rock = outlineShape(dry.x - 10, dry.z + 12, 0.7, 1.2, lumps);
  const house: SolidShape = { points: [dry.x - 26, dry.z - 4, dry.x - 20, dry.z - 4, dry.x - 20, dry.z + 3, dry.x - 26, dry.z + 3] };
  const solids = solidsOf([trunk, rock, house]);
  const centers = [
    { x: trunk.x, z: trunk.z },
    { x: dry.x - 10, z: dry.z + 12 },
    { x: dry.x - 23, z: dry.z - 0.5 },
  ];
  const outside = (p: Walker): boolean => clearanceAt(solids, p.x, p.z) >= BODY_RADIUS - 1e-6;

  it("stops a body at every solid's edge, from every side, and slides along it without catching", () => {
    expect(clearanceAt(solids, trunk.x + 0.2, trunk.z)).toBeLessThan(0);
    for (const c of centers) {
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2;
        const start = { x: c.x + Math.cos(ang) * 6, z: c.z + Math.sin(ang) * 6 };
        // Straight at the center, and glancing 25 degrees off it.
        for (const off of [0, 0.44]) {
          const dx = -Math.cos(ang + off);
          const dz = -Math.sin(ang + off);
          const path = hold(solids, start, dx, dz, 240);
          for (let i = 1; i < path.length; i++) {
            const p = path[i]!;
            const q = path[i - 1]!;
            expect(outside(p)).toBe(true);
            // No step goes backward against the push, so there is no jitter.
            expect((p.x - q.x) * dx + (p.z - q.z) * dz).toBeGreaterThanOrEqual(-1e-9);
          }
          const end = path[path.length - 1]!;
          if (off === 0 && c === centers[0]) {
            // Pushing straight at a round trunk stops at its bark.
            expect(clearanceAt(solids, end.x, end.z)).toBeCloseTo(BODY_RADIUS, 2);
          }
          if (off > 0 && c !== centers[2]) {
            // A glancing push slides around a trunk or a rock and on past it.
            expect((end.x - c.x) * dx + (end.z - c.z) * dz).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("passes between two solids with room for the body, and stops still at a gap too narrow", () => {
    for (const [gap, passes] of [[BODY_RADIUS * 2 + 0.15, true], [BODY_RADIUS * 2 - 0.2, false]] as const) {
      const r = 0.6;
      const pair = solidsOf([
        { x: dry.x - 10, z: dry.z - r - gap / 2, radius: r },
        { x: dry.x - 10, z: dry.z + r + gap / 2, radius: r },
      ]);
      // A little off the gap's center, so the walk must slide into it.
      const path = hold(pair, { x: dry.x - 4, z: dry.z + 0.12 }, -1, 0, 300);
      for (const p of path) expect(clearanceAt(pair, p.x, p.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);
      const end = path[path.length - 1]!;
      expect(end.x < dry.x - 12).toBe(passes);
      if (!passes) {
        const still = path.slice(-60);
        for (const p of still) expect(p).toEqual(still[0]);
      }
    }
  });

  it("walks a tap around what stands in the way and arrives, or stops at the nearest place it can reach, turning in curves", () => {
    // A wall of rocks across the way and a trunk past it.
    const wall = solidsOf([
      ...[-3, -1.4, 0, 1.4, 3].map((dz) => outlineShape(dry.x - 12, dry.z + dz, dz, 1, lumps)),
      { x: dry.x - 17, z: dry.z + 0.5, radius: 0.6 },
    ]);
    const target = { x: dry.x - 24, z: dry.z };
    const walk = tapWalk(wall, dry, target);
    expect(walk.state).toBe("arrived");
    expect(Math.hypot(walk.at.x - target.x, walk.at.z - target.z)).toBeLessThanOrEqual(WALK_TO.reach);
    let heading = Number.NaN;
    for (let i = 1; i < walk.path.length; i++) {
      const p = walk.path[i]!;
      const q = walk.path[i - 1]!;
      expect(clearanceAt(wall, p.x, p.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);
      const h = Math.atan2(p.z - q.z, p.x - q.x);
      if (!Number.isNaN(heading)) {
        // At most 12 degrees of turn in a sixtieth of a second.
        expect(Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading)))).toBeLessThan(0.21);
      }
      heading = h;
    }
    // A tap on a solid walks up to its face, and a tap ringed by solids stops at the nearest place it can reach.
    const face = tapWalk(solids, { x: trunk.x + 8, z: trunk.z }, { x: trunk.x, z: trunk.z });
    expect(face.state).toBe("arrived");
    expect(face.at.x).toBeGreaterThan(trunk.x);
    expect(clearanceAt(solids, face.at.x, face.at.z)).toBeLessThan(WALK_TO.reach + BODY_RADIUS + 0.1);
    const goal = { x: dry.x - 14, z: dry.z };
    const ring = solidsOf(Array.from({ length: 14 }, (_, k) => ({ x: goal.x + Math.cos((k / 14) * Math.PI * 2) * 3, z: goal.z + Math.sin((k / 14) * Math.PI * 2) * 3, radius: 0.62 })));
    const ringed = tapWalk(ring, dry, goal);
    expect(ringed.state).toBe("arrived");
    expect(Math.hypot(ringed.at.x - goal.x, ringed.at.z - goal.z)).toBeGreaterThan(3);
    for (const p of ringed.path) expect(clearanceAt(ring, p.x, p.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);
  });
});

describe("every opening is walkable", () => {
  /** The room a spot needs to count as open: a body, and the clearance a planned walk keeps from what stops it. */
  const ROOM = BODY_RADIUS + WALK_TO.clearance;
  /** The tallest rise a person climbs in one stride, as up a flight of steps, in meters. */
  const STEP = 0.4;
  /** Meters between the spots checked for room to stand. */
  const CELL = 0.25;
  /** The sample world's land made level, so a built thing's base is the ground all around it. */
  const flat: Terrain = { ...t, lattice: { ...t.lattice, heights: t.lattice.heights.slice().fill(heightAt(t.lattice, dry.x, dry.z)) } };
  /**
   * Walks with the keys along `way`, a line of points close together, always heading for the point a little ahead,
   * until the body stands on its end or is wedged. Returns each frame's place.
   */
  const keysAlong = (solids: Solids, way: readonly Walker[]): Walker[] => {
    const path = [way[0]!];
    const end = way[way.length - 1]!;
    for (let i = 0, k = 0; i < 60 * 60; i++) {
      const at = path[path.length - 1]!;
      if (Math.hypot(end.x - at.x, end.z - at.z) <= BODY_RADIUS) break;
      while (k < way.length - 1 && Math.hypot(way[k]!.x - at.x, way[k]!.z - at.z) < WALK_TO.lookAhead) k++;
      const next = walkStep(flat, solids, at, { dx: way[k]!.x - at.x, dz: way[k]!.z - at.z, speed: WALK_TO.pace }, dt);
      if (Math.hypot(next.x - at.x, next.z - at.z) < WALK_TO.stall * WALK_TO.pace * dt) break;
      path.push(next);
    }
    return path;
  };

  /**
   * Points a fifth of a meter apart or closer, as x, z pairs in a built thing's own frame, on everything a person
   * would bump into there within their height above the ground or floor beneath: each face shown at full vitality,
   * except the walkable ones a person stands on.
   */
  function inTheWay(parts: readonly Part[], floor: Floor | null): number[] {
    const out: number[] = [];
    for (const part of parts) {
      if (part.collision === "walkable") continue;
      const p = part.positions;
      for (let k = 0; k < part.indices.length; k += 3) {
        const vs = [part.indices[k]!, part.indices[k + 1]!, part.indices[k + 2]!] as const;
        // A piece that grows in only as the thing declines, such as fallen stone, is not there at full vitality.
        if (vs.some((v) => (part.channels.grow?.[v] ?? 0) > 0)) continue;
        const corner = (v: number): readonly [number, number, number] => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
        const [a, b, c] = [corner(vs[0]), corner(vs[1]), corner(vs[2])];
        const under = floor === null ? 0 : Math.max(0, deckAt([floor], (a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3));
        const n = Math.max(1, Math.ceil(Math.max(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])) / 0.2));
        for (let i = 0; i <= n; i++) {
          for (let j = 0; i + j <= n; j++) {
            const [u, v, w] = [i / n, j / n, 1 - (i + j) / n];
            const y = a[1] * u + b[1] * v + c[1] * w;
            if (y >= under + BODY_BAND.from && y <= under + BODY_BAND.to) out.push(a[0] * u + b[0] * v + c[0] * w, a[2] * u + b[2] * v + c[2] * w);
          }
        }
      }
    }
    return out;
  }

  /**
   * The openings of a built thing, in its own frame: every spot inside its outline on the ground where a body has
   * room to stand clear of all it shows, a meter apart, each with the shortest way in to it from the open land around
   * the thing over such spots.
   */
  function openingsOf(points: readonly number[]): Walker[][] {
    let reach = 0;
    const near = new Map<string, number[]>();
    for (let k = 0; k < points.length; k += 2) {
      const [x, z] = [points[k]!, points[k + 1]!];
      reach = Math.max(reach, Math.hypot(x, z));
      const key = `${Math.floor(x)},${Math.floor(z)}`;
      const list = near.get(key);
      if (list === undefined) near.set(key, [x, z]);
      else list.push(x, z);
    }
    const roomAt = (x: number, z: number): boolean => {
      for (let i = Math.floor(x - ROOM); i <= Math.floor(x + ROOM); i++) {
        for (let j = Math.floor(z - ROOM); j <= Math.floor(z + ROOM); j++) {
          const list = near.get(`${i},${j}`) ?? [];
          for (let k = 0; k < list.length; k += 2) if (Math.hypot(list[k]! - x, list[k + 1]! - z) < ROOM) return false;
        }
      }
      return true;
    };
    const outline = solidsOf([{ points }]);
    const side = Math.ceil((reach + 3) / CELL);
    const n = side * 2 + 1;
    const at = (i: number): Walker => ({ x: ((i % n) - side) * CELL, z: (Math.floor(i / n) - side) * CELL });
    // Out from the open land around the thing, one spot with room after another.
    const from = new Int32Array(n * n).fill(-2);
    const queue: number[] = [];
    for (let i = 0; i < n * n; i++) {
      const [u, v] = [i % n, Math.floor(i / n)];
      if (u === 0 || v === 0 || u === n - 1 || v === n - 1) {
        from[i] = -1;
        queue.push(i);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const [u, v] = [i % n, Math.floor(i / n)];
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const [nu, nv] = [u + du, v + dv];
        const k = nv * n + nu;
        if (nu < 0 || nv < 0 || nu >= n || nv >= n || from[k] !== -2) continue;
        const spot = at(k);
        if (!roomAt(spot.x, spot.z)) continue;
        from[k] = i;
        queue.push(k);
      }
    }
    const step = Math.round(1 / CELL);
    const ways: Walker[][] = [];
    from.forEach((f, i) => {
      if (f === -2 || (i % n) % step !== 0 || Math.floor(i / n) % step !== 0 || clearanceAt(outline, at(i).x, at(i).z) >= 0) return;
      const way: Walker[] = [];
      for (let k = i; k >= 0; k = from[k]!) way.unshift(at(k));
      ways.push(way);
    });
    return ways;
  }

  // Builds a landmark for every option of every field of every landmark primitive, and twenty-four buildings drawn from
  // everything Jev can compose, then walks to each of about 1,500 openings and every door. It takes a few seconds
  // alone, more when other work shares the machine.
  it("lets a person walk into every landmark's openings, up its steps and under its spans, and reach every building's door from outside", { timeout: 120_000 }, () => {
    const landmarks = new Library([...LANDMARK_PRIMITIVES, ...FLORA_PRIMITIVES]);
    const draws = rand(seedOf("every opening"));
    const centre = { x: dry.x - 12, z: dry.z - 32 };
    let openings = 0;
    let raised = 0;
    for (const form of LANDMARK_PRIMITIVES) {
      const fields = Object.entries(form.params);
      const count = Math.max(2, ...fields.map(([, f]) => (f.type === "choice" ? Object.keys(f.options).length : f.type === "scale" ? f.levels.length : 2)));
      for (let k = 0; k < count; k++) {
        // Each option of each field in turn, and each level of each scale.
        const params: Record<string, string | boolean> = {};
        fields.forEach(([name, f], i) => {
          if (f.type === "choice") params[name] = Object.keys(f.options)[k % Object.keys(f.options).length]!;
          else if (f.type === "scale") params[name] = f.levels[(k + i) % f.levels.length]!.words;
          else if (f.type === "flag") params[name] = (k + i) % 2 === 0;
        });
        const blueprint = blueprintOf(landmark.id, { ...randomSlots(landmark, landmarks, () => draws.next()), form: { use: form.id, params } });
        const built = realize(blueprint, landmark, landmarks, { seed: seedOf(`every opening ${form.id} ${k}`), facts: { scale: 0.85 + 0.4 * draws.next() } });
        const name = `${form.id} ${JSON.stringify(params)}`;
        const at = { ...centre, y: heightAt(flat.lattice, centre.x, centre.z), yaw: k * 1.3 };
        const [c, s] = [Math.cos(at.yaw), Math.sin(at.yaw)];
        const world = (p: Walker): Walker => ({ x: at.x + p.x * c + p.z * s, z: at.z - p.x * s + p.z * c });
        const solids = solidsOf(piecesShapes(built.parts, at));
        const floor = floorOf(built.parts, at);
        const own = floorOf(built.parts, { x: 0, y: 0, z: 0, yaw: 0 });
        for (const way of openingsOf(inTheWay(built.parts, own))) {
          openings++;
          const spot = way[way.length - 1]!;
          const where = `${name} at ${spot.x}, ${spot.z}`;
          // Walked in with the keys from outside, along the way its open ground leaves.
          const path = keysAlong(solids, way.map(world));
          const end = path[path.length - 1]!;
          expect(Math.hypot(end.x - world(spot).x, end.z - world(spot).z), where).toBeLessThanOrEqual(BODY_RADIUS);
          if (floor === null) continue;
          // Up steps a stride at a time, never dropping through the floor, to stand on it where it is raised.
          const ground = path.map((q) => footingAt(flat, [floor], q.x, q.z).ground);
          for (let i = 1; i < ground.length; i++) expect(Math.abs(ground[i]! - ground[i - 1]!), where).toBeLessThan(STEP);
          if (own === null || deckAt([own], spot.x, spot.z) <= 0.05) continue;
          raised++;
          expect(footingAt(flat, [floor], end.x, end.z).deck, where).toBe(true);
        }
      }
    }
    expect(openings).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);

    const buildings = new Library([...STRUCTURE_PRIMITIVES, ...FLORA_PRIMITIVES]);
    for (let i = 0; i < 24; i++) {
      const blueprint = blueprintOf(structure.id, randomSlots(structure, buildings, () => draws.next()));
      const built = realize(blueprint, structure, buildings, { seed: seedOf(`every door ${i}`), facts: { size: 1, floors: 1 } });
      const plan = built.slots.get("footprint")?.output as BuildingPlan;
      const name = JSON.stringify(blueprint.slots);
      const site = { x: dry.x - 40, z: dry.z, yaw: i * 0.9, level: heightAt(t.lattice, dry.x - 40, dry.z) };
      // What stops a walker, as the world builds it: the walls and what stands beside them, such as a mill wheel.
      const e = extentOf(built.slots.get("feature")?.output as Built | undefined);
      const beside: SolidShape[] = e === null ? [] : [{ points: [[e.x0, e.z0], [e.x1, e.z0], [e.x1, e.z1], [e.x0, e.z1]].flatMap(([lx, lz]) => siteToWorld(site, lx!, lz!)) }];
      const solids = solidsOf([...wallsShape(plan, site), ...beside]);
      // A building is solid: every mass stops a walker.
      for (const m of plan.masses) expect(clearanceAt(solids, ...siteToWorld(site, m.x, m.z)), name).toBeLessThan(0);
      const doors = plan.openings.filter((o) => o.kind === "door");
      expect(doors.length, name).toBeGreaterThan(0);
      for (const door of doors) {
        // A body fits on the doorstep, with no wing in front of it, and a walk from out in front of it arrives there.
        const spot = siteToWorld(site, door.position[0] + door.normal[0] * (BODY_RADIUS + 0.1), door.position[2] + door.normal[2] * (BODY_RADIUS + 0.1));
        const from = siteToWorld(site, door.position[0] + door.normal[0] * 20, door.position[2] + door.normal[2] * 20);
        expect(clearanceAt(solids, ...spot), name).toBeGreaterThanOrEqual(BODY_RADIUS);
        const walk = tapWalk(solids, { x: from[0], z: from[1] }, { x: spot[0], z: spot[1] });
        expect(Math.hypot(walk.at.x - spot[0], walk.at.z - spot[1]), name).toBeLessThanOrEqual(WALK_TO.reach);
      }
    }
  });
});

describe("walking off the land", () => {
  it("walks straight off the codebase's land and on for two kilometers without stopping, eyes always on the ground, and takes a tap there to the very spot", () => {
    let at: Walker = { x: 0, z: t.spec.size / 4 };
    let farthest = 0;
    for (let i = 0; i < 2200 / (WALK_TO.pace * dt * 2.4); i++) {
      const next = walkStep(t, NO_SOLIDS, at, { dx: 0.6, dz: 0.8, speed: WALK_TO.pace * 2.4 }, dt);
      expect(Math.hypot(next.x - at.x, next.z - at.z)).toBeGreaterThan(0);
      at = next;
      farthest = Math.max(farthest, Math.hypot(at.x, at.z));
    }
    expect(farthest).toBeGreaterThan(landHalf(t) * Math.SQRT2 + 1800);
    expect(stanceAt(t, at.x, at.z).eye).toBeCloseTo(groundHeightAt(t, at.x, at.z) + EYE_HEIGHT, 6);
    // A tap far out in the wild walks to the very spot tapped.
    const to = { x: -(landHalf(t) + 600), z: 140 };
    const walk = planWalk(t, NO_SOLIDS, { x: 0, z: 0 }, to);
    expect(walk.target.x).toBeCloseTo(to.x, 6);
    expect(walk.target.z).toBeCloseTo(to.z, 6);
  });
});

describe("a walker's stride", () => {
  /** Walks `seconds` from `from` toward (dx, dz) at `speed`, then rests for `rest` seconds. Returns each frame's body and whether it was asked to move. */
  const walkThen = (decks: readonly Deck[], from: Walker, dx: number, dz: number, seconds: number, rest: number, speed = WALK_TO.pace) => {
    let body = standAt(t, decks, from.x, from.z);
    const frames: { body: Stride; moving: boolean }[] = [];
    for (let i = 0; i < Math.round((seconds + rest) * 60); i++) {
      const moving = i < seconds * 60;
      body = stride(t, NO_SOLIDS, decks, body, moving ? { dx, dz, speed } : { dx: 0, dz: 0, speed: 0 }, dt);
      frames.push({ body, moving });
    }
    return frames;
  };
  const speedOf = (b: Stride): number => Math.hypot(b.vx, b.vz);
  /**
   * Dry ground near `dry` whose westward grade is steady over the first 2 m, so the pace the grade allows stays
   * constant while a walker heading west speeds up. Any overshoot then comes from the gait alone.
   */
  const evenGround = (): Walker => {
    for (let r = 0; r <= 200; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = dry.x + r * Math.cos((a * Math.PI) / 8);
        const z = dry.z + r * Math.sin((a * Math.PI) / 8);
        if (waterDepthAt(t, x, z) > 0 || waterDepthAt(t, x - 2, z) > 0) continue;
        const h = [0, 1, 2, 3, 4].map((d) => groundHeightAt(t, x - d * 0.5, z));
        const grades = h.slice(1).map((y, i) => (h[i]! - y) / 0.5);
        if (Math.max(...grades) - Math.min(...grades) < 1e-3) return { x, z };
      }
    }
    throw new Error("No dry ground with a steady grade near the sample world's dry land.");
  };

  it("gets going and stops at once, never overshooting or turning, and its eyes ride the ground without bob or jitter", () => {
    const frames = walkThen([], evenGround(), -1, 0, 6, 3);
    const striding = frames.slice(120, 360);
    const pace = striding.reduce((m, f) => Math.max(m, speedOf(f.body)), 0);
    // Up to speed within a fraction of a second, as in games, with no overshoot. While it speeds up on a steady grade,
    // its speed only rises.
    expect(speedOf(frames[Math.round(0.15 * 60)]!.body)).toBeGreaterThan(pace * 0.9);
    const going = frames.slice(0, Math.round(0.3 * 60));
    for (let i = 1; i < going.length; i++) expect(speedOf(going[i]!.body)).toBeGreaterThanOrEqual(speedOf(going[i - 1]!.body) - 1e-3);
    // It moves in the requested direction without swinging. Every frame's velocity points along -x.
    for (const f of frames.filter((f) => speedOf(f.body) > 1e-3)) expect(Math.abs(f.body.vz) / speedOf(f.body)).toBeLessThan(1e-6);
    // After release it stops within a fraction of a second, slowing along its direction and never stepping back.
    const stopped = frames.findIndex((f) => !f.moving);
    expect(speedOf(frames[stopped + Math.round(0.15 * 60)]!.body)).toBeLessThan(pace * 0.05);
    for (const f of frames.slice(stopped)) expect(f.body.vx).toBeLessThanOrEqual(1e-9);
    // The eyes stay 1.6 m over the ground, never lagging or floating by more than a few centimeters.
    for (const f of striding) expect(Math.abs(f.body.eye - footingAt(t, [], f.body.x, f.body.z).eye)).toBeLessThan(0.08);
    // Only the ground moves them. Their vertical acceleration, through a Hann window, has almost nothing above 4 Hz.
    const acc = striding.slice(1, -1).map((f, i, all) => ((striding[i + 2]!.body.eye - 2 * f.body.eye + striding[i]!.body.eye) / (dt * dt)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (all.length - 1))));
    let total = 0;
    let high = 0;
    for (let k = 1; k <= acc.length / 2; k++) {
      let re = 0;
      let im = 0;
      acc.forEach((a, n) => {
        re += a * Math.cos((2 * Math.PI * k * n) / acc.length);
        im -= a * Math.sin((2 * Math.PI * k * n) / acc.length);
      });
      total += re * re + im * im;
      if (k / (acc.length * dt) > 4) high += re * re + im * im;
    }
    expect(high / Math.max(total, 1e-12)).toBeLessThan(0.02);
    // Once stopped, it does not move.
    const settled = frames.slice(Math.round(7.5 * 60));
    for (const f of settled) {
      expect(speedOf(f.body)).toBeLessThan(0.01);
      expect(Math.abs(f.body.eye - settled[0]!.body.eye)).toBeLessThan(1e-3);
    }
    // Carried at travel's pace, it stands exactly where it is carried, its eyes riding the ground.
    let body = standAt(t, [], dry.x, dry.z);
    for (let i = 1; i <= 180; i++) {
      const x = dry.x - TRAVEL.pace * i * dt;
      body = carry(t, [], body, x, dry.z, dt);
      expect(body.x).toBe(x);
      expect(body.vx).toBeCloseTo(-TRAVEL.pace, 6);
      // At five times walking pace the ride reads the ground its own lag ahead, so at the brow of a descent the eyes
      // lead the ground down by more than a walk's few centimeters. Where this line goes over the brow of a valley
      // wall falling at a grade of 0.45, about as steep as any valley wall gets, they lead by 0.34 m.
      if (i > 30) expect(Math.abs(body.eye - footingAt(t, [], body.x, body.z).eye)).toBeLessThan(0.4);
    }
  });

  it("stands on a footbridge's deck above the water, and fords beside it once it no longer holds", () => {
    // A deck across the pond, 0.3 m over the water. Walking across, the eyes stay 1.6 m above its planks, dry, and never sink toward the water.
    const water = heightAt(t.lattice, pond.x, pond.z) + waterDepthAt(t, pond.x, pond.z);
    const deck: Deck = { x: pond.x, z: pond.z, cos: 1, sin: 0, half: pond.reach * 1.5, halfWidth: 0.8, base: water, topAt: () => 0.3, way: 0, crossing: { x: pond.x, z: pond.z, yaw: 0, span: pond.reach * 3, level: water, bank: water }, holds: 0 };
    expect(footingAt(t, [deck], pond.x, pond.z)).toMatchObject({ deck: true, depth: 0, eye: water + 0.3 + EYE_HEIGHT });
    const crossing = walkThen([deck], { x: pond.x - pond.reach, z: pond.z }, 1, 0, 4, 1);
    for (const f of crossing.slice(60)) expect(f.body.eye).toBeGreaterThan(water + 0.3 + EYE_HEIGHT - 0.05);
    // Once the deck no longer holds, a way across it fords the water beside it. It never passes through the deck, it
    // eases out to the ford over the bank, and it is unchanged everywhere else.
    const way = Array.from({ length: Math.round(pond.reach * 8) + 1 }, (_, i) => ({ x: pond.x - pond.reach * 4 + i * 1, z: pond.z }));
    const ford = fordBeside(t, way, [deck]);
    for (const p of ford) expect(Math.abs(p.x - deck.x) <= deck.half && Math.abs(p.z - deck.z) <= deck.halfWidth + 0.15).toBe(false);
    for (let i = 1; i < ford.length; i++) expect(Math.hypot(ford[i]!.x - ford[i - 1]!.x, ford[i]!.z - ford[i - 1]!.z)).toBeLessThan(1.6);
    expect([ford[0], ford[ford.length - 1]]).toEqual([way[0], way[way.length - 1]]);
  });
});
