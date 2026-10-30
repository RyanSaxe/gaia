import { describe, expect, it } from "vitest";
import { Library, type RouteSpec } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import { BODY_RADIUS, NO_SOLIDS, STEER, TRAVEL, type Travel, type TrailEnd, type TrailRequest, type Trip, type Walker, acrossWay, bakeTerrain, clearanceAt, planTrails, planTrip, solidsOf, travelFrom, travelStep, trailWay, waterDepthAt } from "@gaia/terrain";
import { sampleWorld } from "@gaia/terrain/testing";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const STYLE: RouteSpec = { width: 1.4, wear: 0.7, edging: "none", winding: 0.45, crossing: "footbridge" };
const DT = 1 / 60;
const turnTo = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** The sample world's trails between every pair of region centers, planned once and only read. */
const t = bakeTerrain(sampleWorld(), lib);
const ends: TrailEnd[] = t.spec.regions.map((r) => ({ id: r.id, x: r.x * 0.8, z: r.z * 0.8 }));
const requests: TrailRequest[] = ends.flatMap((a, i) => ends.slice(i + 1).map((b, j) => ({ id: `${i}-${j}`, from: a, to: b, style: STYLE, want: 1 - (i + j) / 20 })));
const network = planTrails(t, requests, 41);

/** Every step of a trip taken at 60 frames a second, the view left to it, until it ends. */
function take(trip: Trip, yaw: number, stopAt = Infinity): Travel[] {
  const steps = [travelFrom(trip, yaw)];
  for (let k = 0; k < 60 * 600 && !(steps[k] as Travel).done; k++) {
    const at = steps[k] as Travel;
    steps.push(travelStep(trip, at, DT, at.yaw, k >= stopAt));
  }
  return steps;
}

/** The farthest-apart pair of region centers, where the longest trip runs. */
const [far0, far1] = ends.flatMap((a) => ends.map((b) => [a, b] as const)).reduce((m, p) => (Math.hypot(p[0].x - p[1].x, p[0].z - p[1].z) > Math.hypot(m[0].x - m[1].x, m[0].z - m[1].z) ? p : m));
const way = trailWay(network, far0, far1) as Walker[];

// Baking the sample world and planning its trails takes a second or two alone, more when other work shares the machine.
describe("travel along the trails", { timeout: 20_000 }, () => {
  it("turns the view no faster than a held key, sets off only facing the way, and gets going and slows at its steady rates", () => {
    const trip = planTrip(way, { start: 0, end: 0 });
    // Facing almost backward, the view turns around first.
    const steps = take(trip, (trip.heading[0] as number) + Math.PI - 0.1);
    const last = steps[steps.length - 1] as Travel;
    expect(last.done).toBe(true);
    expect(last.s).toBeCloseTo(trip.length, 2);
    for (let k = 1; k < steps.length; k++) {
      const a = steps[k - 1] as Travel;
      const b = steps[k] as Travel;
      expect(Math.abs(turnTo(a.yaw, b.yaw))).toBeLessThanOrEqual(STEER.rate * DT + 1e-6);
      expect(b.v - a.v).toBeLessThanOrEqual(TRAVEL.accel * DT + 1e-6);
      expect(b.v).toBeLessThanOrEqual(TRAVEL.pace + 1e-6);
      if (!b.going) expect(b.s).toBe(0);
    }
    // Slowing to arrive stays at the steady rate, except for the last creep.
    for (let k = 1; k < steps.length; k++) {
      const a = steps[k - 1] as Travel;
      const b = steps[k] as Travel;
      if (b.v >= TRAVEL.creep) expect(a.v - b.v).toBeLessThanOrEqual(TRAVEL.accel * DT * 1.05 + 1e-6);
    }
    // Once going, the view stays on the way ahead, and the bends never outrun it.
    const going = steps.findIndex((s) => s.going);
    const offWay = steps.slice(going).map((s) => Math.abs(turnTo(s.yaw, headingNear(trip, s.s))));
    expect(Math.max(...offWay)).toBeLessThan(TRAVEL.facing);
  });

  it("leaves the view to a hand that turns it and takes it again once it looks along the way, and brakes without turning when the person takes the keys", () => {
    const trip = planTrip(way, { start: 0, end: 0 });
    let at = travelFrom(trip, trip.heading[0] as number);
    for (let k = 0; k < 300; k++) at = travelStep(trip, at, DT, at.yaw);
    // The person looks off to the side and holds it there.
    const aside = at.yaw + 1.2;
    at = travelStep(trip, at, DT, aside);
    expect(at.follows).toBe(false);
    for (let k = 0; k < 120; k++) {
      at = travelStep(trip, at, DT, aside);
      expect(at.yaw).toBe(aside);
    }
    expect(at.v).toBeGreaterThan(0);
    // Looking along the way again, the trip turns the view with its bends.
    at = travelStep(trip, at, DT, headingNear(trip, at.s));
    expect(at.follows).toBe(true);
    // The person takes over with the keys where the trip goes fastest. It slows at the brake's steady rate and never
    // turns the view.
    const whole = take(trip, trip.heading[0] as number);
    const fastest = whole.reduce((m, s, k) => (s.v > (whole[m] as Travel).v ? k : m), 0);
    const steps = take(trip, trip.heading[0] as number, fastest);
    const from = steps[fastest] as Travel;
    expect(from.v).toBeGreaterThan(TRAVEL.pace / 2);
    const last = steps[steps.length - 1] as Travel;
    expect(last.v).toBe(0);
    expect(last.s).toBeLessThan(trip.length);
    for (let k = fastest + 1; k < steps.length; k++) {
      expect((steps[k] as Travel).yaw).toBe(from.yaw);
      expect((steps[k - 1] as Travel).v - (steps[k] as Travel).v).toBeLessThanOrEqual(TRAVEL.brake * DT + 1e-6);
    }
  });

  it("waits where the world ahead is not yet ready, slowing at its steady rate, and goes on once it is", () => {
    const trip = planTrip(way, { start: 0, end: 0 });
    let at = travelFrom(trip, trip.heading[0] as number);
    // With nothing ready, the view turns but the body stays put.
    for (let k = 0; k < 60; k++) at = travelStep(trip, at, DT, at.yaw, false, 0);
    expect(at.s).toBe(0);
    // With the world ready to 200 m, it goes and slows to a stop there.
    for (let k = 0; k < 60 * 40; k++) {
      const next = travelStep(trip, at, DT, at.yaw, false, 200);
      expect(next.s).toBeLessThanOrEqual(200);
      expect(at.v - next.v).toBeLessThanOrEqual(TRAVEL.accel * DT * 1.05 + 1e-6);
      at = next;
    }
    expect(at.s).toBeGreaterThan(199);
    expect(at.v).toBeLessThan(0.5);
    // With the world ready to the end, it goes on and arrives.
    for (let k = 0; k < 60 * 600 && !at.done; k++) at = travelStep(trip, at, DT, at.yaw);
    expect(at.done).toBe(true);
    expect(at.s).toBeCloseTo(trip.length, 2);
  });

  it("goes straight across the land out of the water and around what stands", () => {
    const pond = t.ponds[0] as (typeof t.ponds)[number];
    const from = { x: pond.x - pond.reach * 2.5, z: pond.z };
    const to = { x: pond.x + pond.reach * 2.5, z: pond.z };
    /** Points a meter or less apart from a to b. */
    const along = (a: Walker, b: Walker): Walker[] => {
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n }));
    };
    // Straight over, it would swim the pond.
    expect(Math.max(...along(from, to).map((p) => waterDepthAt(t, p.x, p.z)))).toBeGreaterThan(1);
    // Boulders sit on the banks on the way around.
    const solids = solidsOf([{ x: pond.x, z: pond.z - pond.reach * 1.3, radius: 3 }, { x: pond.x, z: pond.z + pond.reach * 1.3, radius: 3 }]);
    for (const s of [NO_SOLIDS, solids]) {
      const way = acrossWay(t, s, from, to) as Walker[];
      expect(way).not.toBeNull();
      expect(way[0]).toEqual(from);
      expect(Math.hypot((way[way.length - 1] as Walker).x - to.x, (way[way.length - 1] as Walker).z - to.z)).toBeLessThan(0.5);
      let length = 0;
      for (let i = 1; i < way.length; i++) {
        const a = way[i - 1] as Walker;
        const b = way[i] as Walker;
        length += Math.hypot(b.x - a.x, b.z - a.z);
        for (const p of along(a, b)) {
          expect(waterDepthAt(t, p.x, p.z)).toBeLessThan(0.6);
          expect(clearanceAt(s, p.x, p.z)).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-3);
        }
      }
      expect(length).toBeLessThan(Math.hypot(to.x - from.x, to.z - from.z) * 2.5);
    }
  });

});

/** The trip's way ahead at `s`, read from its samples. */
function headingNear(trip: Trip, s: number): number {
  const i = Math.min(trip.heading.length - 1, Math.round((s / trip.length) * (trip.heading.length - 1)));
  return trip.heading[i] as number;
}
