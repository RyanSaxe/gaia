import { describe, expect, it } from "vitest";
import { Library, rand } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES, standingStones } from "@gaia/primitives";
import {
  BODY_RADIUS,
  EYE_HEIGHT,
  NO_SOLIDS,
  SWIM,
  type SolidShape,
  type Solids,
  type Terrain,
  WALK_TO,
  type Walker,
  bakeTerrain,
  groundHeightAt,
  landHalf,
  clearanceAt,
  heightAt,
  outlineShape,
  piecesShapes,
  planWalk,
  sampleWorld,
  solidsOf,
  stanceAt,
  wadeSpeed,
  walkStep,
  walkToward,
  waterDepthAt,
} from "@gaia/terrain";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const t: Terrain = bakeTerrain(sampleWorld(), lib);
const pond = t.ponds[0]!;
const dt = 1 / 60;
const hold = (solids: Solids, from: Walker, dx: number, dz: number, steps: number, speed = WALK_TO.pace): Walker[] => {
  const path = [from];
  for (let i = 0; i < steps; i++) path.push(walkStep(t, solids, path[path.length - 1]!, { dx, dz, speed }, dt));
  return path;
};
/** Steps a tapped walk until it ends, at most two minutes of it. */
const tapWalk = (solids: Solids, from: Walker, to: Walker) => {
  // One walker moved in place, as the lab moves it, so a way must not lean on the walker it was planned from.
  const at = { x: from.x, z: from.z };
  let walk = planWalk(t, solids, at, to);
  const path: Walker[] = [{ ...at }];
  for (let i = 0; i < 7200; i++) {
    const next = walkToward(t, solids, at, walk, dt);
    walk = next.walk;
    if (next.walker !== at) path.push({ ...next.walker });
    at.x = next.walker.x;
    at.z = next.walker.z;
    if (next.state !== "walking") return { state: next.state, at: { ...at }, path, walk, seconds: (i + 1) * dt };
  }
  return { state: "walking" as const, at: { ...at }, path, walk, seconds: 120 };
};
// The sample world's pond lies near its east edge, so the dry ground to walk on is west of it.
const dry = { x: pond.x - pond.reach * 2.5, z: pond.z };

describe("wading and swimming", () => {
  it("measures water depth as the surface above the ground, and none on dry land", () => {
    expect(waterDepthAt(t, pond.x, pond.z)).toBeGreaterThan(SWIM.to);
    expect(waterDepthAt(t, dry.x, dry.z)).toBe(0);
    for (let k = 0; k < 400; k++) expect(waterDepthAt(t, ((k * 37) % 300) - 150, ((k * 91) % 300) - 150)).toBeGreaterThanOrEqual(0);
  });

  it("slows as the water deepens, swims slower still, and is never stopped by water", () => {
    expect(wadeSpeed(0)).toBe(1);
    expect(wadeSpeed(1.1)).toBeCloseTo(0.4, 6);
    expect(wadeSpeed(SWIM.to)).toBeCloseTo(SWIM.pace, 6);
    for (let d = 0; d < 4; d += 0.05) expect(wadeSpeed(d + 0.05)).toBeLessThanOrEqual(wadeSpeed(d));
    // Anywhere in the pond, a step in any direction moves the walker its full wading or swimming stride.
    for (let r = 0; r < pond.reach; r += 3) {
      for (let a = 0; a < 8; a++) {
        const at = { x: pond.x + r * 0.7, z: pond.z + r * 0.7 };
        const ang = (a / 8) * Math.PI * 2;
        const next = walkStep(t, NO_SOLIDS, at, { dx: Math.cos(ang), dz: Math.sin(ang), speed: 4 }, 0.1);
        expect(Math.hypot(next.x - at.x, next.z - at.z)).toBeCloseTo(4 * 0.1 * wadeSpeed(waterDepthAt(t, at.x, at.z)), 6);
      }
    }
    // Held keys carry the walker across the deep middle and out the far side.
    const path = hold(NO_SOLIDS, dry, 1, 0, 60 * 90);
    const far = path.findIndex((p) => p.x > pond.x + pond.reach * 1.2);
    expect(far).toBeGreaterThan(0);
    expect(path.slice(0, far).some((p) => waterDepthAt(t, p.x, p.z) > SWIM.to)).toBe(true);
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
        // Never a jump: the eyes rise and fall no faster than the steepest bank the relief budget allows.
        expect(Math.abs(s.eye - stanceAt(t, q.x, q.z).eye)).toBeLessThanOrEqual(moved * 0.9 + 1e-6);
      }
    }
    expect(swam).toBe(1);
    // In the pond's deep middle the eyes float just above the surface.
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
        // Straight at the middle, and glancing 25 degrees off it.
        for (const off of [0, 0.44]) {
          const dx = -Math.cos(ang + off);
          const dz = -Math.sin(ang + off);
          const path = hold(solids, start, dx, dz, 240);
          for (let i = 1; i < path.length; i++) {
            const p = path[i]!;
            const q = path[i - 1]!;
            expect(outside(p)).toBe(true);
            // Never a step backward against the push: no jitter.
            expect((p.x - q.x) * dx + (p.z - q.z) * dz).toBeGreaterThanOrEqual(-1e-9);
          }
          const end = path[path.length - 1]!;
          if (off === 0 && c === centers[0]) {
            // Straight at a round trunk: stopped at its bark.
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
      // A little off the gap's middle, so the walk must slide into it.
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

  it("walks a tap around what stands in the way and arrives, turning in curves", () => {
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
  });

  it("walks up to a tapped solid's face, and stops at the nearest reachable place when solids ring the target", () => {
    const face = tapWalk(solids, { x: trunk.x + 8, z: trunk.z }, { x: trunk.x, z: trunk.z });
    expect(face.state).toBe("arrived");
    expect(face.at.x).toBeGreaterThan(trunk.x);
    expect(clearanceAt(solids, face.at.x, face.at.z)).toBeLessThan(WALK_TO.reach + BODY_RADIUS + 0.1);
    const goal = { x: dry.x - 14, z: dry.z };
    const ring = solidsOf(Array.from({ length: 14 }, (_, k) => ({ x: goal.x + Math.cos((k / 14) * Math.PI * 2) * 3, z: goal.z + Math.sin((k / 14) * Math.PI * 2) * 3, radius: 0.62 })));
    const walk = tapWalk(ring, dry, goal);
    expect(walk.state).toBe("arrived");
    expect(Math.hypot(walk.at.x - goal.x, walk.at.z - goal.z)).toBeGreaterThan(3);
    for (const p of walk.path) expect(clearanceAt(ring, p.x, p.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);
  });
});

describe("solid pieces of a built thing", () => {
  const ring = (lintels: boolean, centre: "nothing" | "a tall king stone") =>
    standingStones.build({ count: 9, height: 5.2, lintels, centre, facets: 0.55 }, { rand: rand(5), facts: {} }, null);
  const at = { x: dry.x - 12, y: heightAt(t.lattice, dry.x - 12, dry.z - 32), z: dry.z - 32, yaw: 0.4 };

  it("stops a walker at each standing stone, never at a lintel overhead, and leaves a ring's open middle free", () => {
    const open = piecesShapes(ring(true, "nothing").parts, at);
    expect(open.length).toBe(piecesShapes(ring(false, "nothing").parts, at).length);
    expect(open.length).toBeGreaterThanOrEqual(9);
    const solids = solidsOf(open);
    expect(clearanceAt(solids, at.x, at.z)).toBeGreaterThan(BODY_RADIUS);
    // A tap from outside the ring walks between the stones to its middle.
    let walker: Walker = { x: at.x + 16, z: at.z + 3 };
    let walk = planWalk(t, solids, walker, { ...walker, x: at.x, z: at.z });
    let state = "walking";
    for (let i = 0; i < 1800 && state === "walking"; i++) {
      const step = walkToward(t, solids, walker, walk, 1 / 60);
      ({ walker, walk, state } = step);
      expect(clearanceAt(solids, walker.x, walker.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);
    }
    expect(state).toBe("arrived");
    // A king stone at the middle blocks it.
    expect(clearanceAt(solidsOf(piecesShapes(ring(true, "a tall king stone").parts, at)), at.x, at.z)).toBeLessThan(0);
  });
});

describe("walking to a tapped point", () => {
  const firstStep = (target: Walker): number => {
    const { walker } = walkToward(t, NO_SOLIDS, dry, planWalk(t, NO_SOLIDS, dry, target), dt);
    return Math.hypot(walker.x - dry.x, walker.z - dry.z);
  };

  it("walks to a point on dry ground and ends the walk within reach of it", () => {
    const target = { x: dry.x - 12, z: dry.z + 5 };
    expect(waterDepthAt(t, target.x, target.z)).toBe(0);
    const walk = tapWalk(NO_SOLIDS, dry, target);
    expect(walk.state).toBe("arrived");
    expect(Math.hypot(walk.at.x - target.x, walk.at.z - target.z)).toBeLessThanOrEqual(WALK_TO.reach);
    // At walking pace, straight there.
    expect(walk.seconds).toBeCloseTo((13 - WALK_TO.reach) / WALK_TO.pace, 1);
  });

  it("walks to a near point at walking pace and jogs toward a far one", () => {
    expect(firstStep({ x: dry.x - 10, z: dry.z })).toBeCloseTo(WALK_TO.pace * dt, 6);
    expect(firstStep({ x: dry.x - 60, z: dry.z })).toBeCloseTo(WALK_TO.pace * WALK_TO.jog * dt, 6);
  });

  it("crosses a pond all the way, swimming its deep middle", () => {
    const west = { x: pond.x - pond.reach * 1.6, z: pond.z };
    const east = { x: pond.x + pond.reach * 1.6, z: pond.z };
    const walk = tapWalk(NO_SOLIDS, west, east);
    expect(walk.state).toBe("arrived");
    expect(walk.path.some((p) => stanceAt(t, p.x, p.z).swim === 1)).toBe(true);
  });

  it("ends the walk where it stands when the point is within reach", () => {
    const walk = planWalk(t, NO_SOLIDS, dry, { x: dry.x + 1, z: dry.z + 0.5 });
    expect(walkToward(t, NO_SOLIDS, dry, walk, dt)).toEqual({ walker: dry, walk, state: "arrived" });
  });
});

describe("walking off the land", () => {
  it("walks straight off the codebase's land and on for two kilometers without stopping, eyes always on the ground", () => {
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
  });

  it("takes a tap far out in the wild to the very spot tapped", () => {
    const to = { x: -(landHalf(t) + 600), z: 140 };
    const walk = planWalk(t, NO_SOLIDS, { x: 0, z: 0 }, to);
    expect(walk.target.x).toBeCloseTo(to.x, 6);
    expect(walk.target.z).toBeCloseTo(to.z, 6);
  });
});
