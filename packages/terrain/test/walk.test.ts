import { describe, expect, it } from "vitest";
import { type BuildingPlan, Library, blueprintOf, rand } from "@gaia/schema";
import { BIOME_PRIMITIVES, PRIMITIVES, RELIEF_PRIMITIVES, ROCK_ARCH_FORMS, ROCK_ARCH_SHAPE, ROTUNDA_SHAPE, landmarkShape, rockArch, rotunda, standingStones } from "@gaia/primitives";
import { structure } from "@gaia/kinds";
import { buildSlots } from "@gaia/realize";
import {
  BODY_RADIUS,
  type Deck,
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

describe("solid pieces of a built thing", () => {
  const ring = (lintels: boolean, centre: "nothing" | "a tall king stone") =>
    standingStones.build({ arrangement: "ring", count: 9, height: 5.2, lintels, centre, facets: 0.55 }, { rand: rand(5), facts: {} }, null);
  const at = { x: dry.x - 12, y: heightAt(t.lattice, dry.x - 12, dry.z - 32), z: dry.z - 32, yaw: 0.4 };

  it("stops a walker at each standing stone, never at a lintel overhead, and leaves a ring's open middle free", () => {
    const open = piecesShapes(ring(true, "nothing").parts, at);
    expect(open.length).toBe(piecesShapes(ring(false, "nothing").parts, at).length);
    expect(open.length).toBeGreaterThanOrEqual(9);
    const solids = solidsOf(open);
    expect(clearanceAt(solids, at.x, at.z)).toBeGreaterThan(BODY_RADIUS);
    // A tap from outside the ring walks between the stones to its center.
    const walk = tapWalk(solids, { x: at.x + 16, z: at.z + 3 }, { x: at.x, z: at.z });
    for (const p of walk.path) expect(clearanceAt(solids, p.x, p.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);
    expect(walk.state).toBe("arrived");
    // A king stone at the center blocks it.
    expect(clearanceAt(solidsOf(piecesShapes(ring(true, "a tall king stone").parts, at)), at.x, at.z)).toBeLessThan(0);
  });

  it("lets a walker pass under a rock arch along the way through it, between the feet that stop it", () => {
    for (const form of ["a doorway", "a gate", "a great span"] as const) {
      const answers = { form, thickness: 1.35, stone: 1 } as const;
      const arch = rockArch.build(answers, { rand: rand(5), facts: {} }, null);
      const solids = solidsOf(piecesShapes(arch.parts, at));
      // The way runs along the arch's own z, which the world turns toward its trail, (sin yaw, cos yaw) in world space.
      const [wx, wz] = [Math.sin(at.yaw), Math.cos(at.yaw)];
      const walk = tapWalk(solids, { x: at.x - wx * 16, z: at.z - wz * 16 }, { x: at.x + wx * 16, z: at.z + wz * 16 });
      expect(walk.state, form).toBe("arrived");
      // The walk goes straight through under the span, never around a foot.
      for (const q of walk.path) expect(Math.abs((q.x - at.x) * wz - (q.z - at.z) * wx), form).toBeLessThan(1);
      // Each foot, on either side of the opening, stops a walker.
      const foot = landmarkShape(ROCK_ARCH_SHAPE, answers, { rand: rand(5), facts: {} }).half + ROCK_ARCH_FORMS[form].ring * 1.35 * 0.6;
      for (const side of [-1, 1]) expect(clearanceAt(solids, at.x + side * wz * foot, at.z - side * wx * foot), form).toBeLessThan(0);
    }
  });

  it("carries a walker up a rotunda's steps to stand among its columns, which stop it", () => {
    const answers = { columns: "eight", roof: "a high dome", steps: 5 } as const;
    const temple = rotunda.build(answers, { rand: rand(5), facts: {} }, null);
    // The ring radius its seed set, and how far its top step reaches past it.
    const { ring, margin } = landmarkShape(ROTUNDA_SHAPE, answers, { rand: rand(5), facts: {} });
    const floor = floorOf(temple.parts, at);
    if (floor === null) throw new Error("A rotunda has a floor.");
    const solids = solidsOf(piecesShapes(temple.parts, at));
    // In from 16 m in front, along the rotunda's own z, through the gap between two columns that faces the way in.
    const [wx, wz] = [Math.sin(at.yaw), Math.cos(at.yaw)];
    const walk = tapWalk(solids, { x: at.x + wx * 16, z: at.z + wz * 16 }, { x: at.x, z: at.z });
    expect(walk.state).toBe("arrived");
    for (const q of walk.path) expect(clearanceAt(solids, q.x, q.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);
    // The walk ends on the floor inside, five steps up, and climbs no more than a step at a time on the way.
    const middle = footingAt(t, [floor], at.x, at.z);
    expect(middle.deck).toBe(true);
    expect(middle.ground).toBeCloseTo(at.y + 5 * 0.34, 2);
    let last = -Infinity;
    for (let d = 14; d >= 0; d -= 0.1) {
      const here = footingAt(t, [floor], at.x + wx * d, at.z + wz * d);
      if (here.deck && last > -Infinity) expect(here.ground - last).toBeLessThan(0.36);
      if (here.deck) last = here.ground;
    }
    // Inside the top step, the paving's joints never drop a walk to the ground below it.
    for (let d = ring + margin - 0.3; d >= 0; d -= 0.05) expect(footingAt(t, [floor], at.x + wx * d, at.z + wz * d).deck, `${d.toFixed(2)} m in`).toBe(true);
    // A column in the ring stops a walker.
    const a = Math.PI / 2 + Math.PI / 8;
    const [lx, lz] = [Math.cos(a) * ring, Math.sin(a) * ring];
    expect(clearanceAt(solids, at.x + lx * Math.cos(at.yaw) + lz * wx, at.z - lx * Math.sin(at.yaw) + lz * wz)).toBeLessThan(0);
  });
});

describe("a building's walls", () => {
  it("lets a walker into the open corner of an L-shaped building, and never through a wall", () => {
    const house = blueprintOf("structure", {
      footprint: {
        use: "cottage-plan@1",
        params: { massing: "an L", shape: "snug", size: "modest", storeys: "two storeys", heights: "stepped", roof: "gabled", roofline: "tall and steep", attachments: [], windows: "several", base: "raised up steps", character: "gently settled" },
      },
      body: { use: "timber-frame@1", params: { framing: "posts and rails", plaster: "hand-laid" } },
      roof: { use: "tiles@1", params: { covering: "pantiles", overhang: "sheltering", chimney: "gable" } },
      openings: { use: "casements@1", params: { panes: "four panes", shutters: false, door: "plank" } },
      palette: { use: "palette@1", params: { family: "spring-meadow", contrast: "balanced" } },
    });
    const plan = buildSlots(house, structure, new Library(PRIMITIVES), { seed: 1, facts: { size: 1, floors: 1, reach: 0 } }).get("footprint")?.output as BuildingPlan;
    const site = { x: dry.x - 40, z: dry.z, yaw: 0.3, level: 0 };
    const solids = solidsOf(wallsShape(plan, site));
    // Every mass is solid at its center.
    for (const m of plan.masses) {
      const [x, z] = siteToWorld(site, m.x, m.z);
      expect(clearanceAt(solids, x, z)).toBeLessThan(0);
    }
    // Some corner of the whole footprint lies outside every mass: the L's open corner, where a body fits.
    const inset = BODY_RADIUS + 0.3;
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * (plan.width / 2 - inset), sz * (plan.depth / 2 - inset)] as const));
    const open = corners.filter(([lx, lz]) => plan.masses.every((m) => Math.abs(lx - m.x) > m.width / 2 || Math.abs(lz - m.z) > m.depth / 2));
    expect(open.length).toBeGreaterThan(0);
    for (const [lx, lz] of open) {
      const [x, z] = siteToWorld(site, lx, lz);
      expect(clearanceAt(solids, x, z)).toBeGreaterThan(BODY_RADIUS);
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
