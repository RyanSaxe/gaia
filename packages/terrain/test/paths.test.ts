import { describe, expect, it } from "vitest";
import { Library, type RouteSpec } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import {
  TRAILS,
  type Crossing,
  type Terrain,
  type TrailEnd,
  type TrailNetwork,
  type TrailRequest,
  type Way,
  type WayCarry,
  bakeTerrain,
  findLandmarkSite,
  heightAt,
  planTrails,
  slopeAt,
  trailWearAt,
  waterDepthAt,
  wayWear,
  wayWearAt,
} from "@gaia/terrain";
import { randomWorld, sampleWorld } from "@gaia/terrain/testing";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const STYLE: RouteSpec = { width: 1.4, wear: 0.7, edging: "none", winding: 0.45, crossing: "footbridge" };
/** Baked once for every test here: the sample world first, then two random ones. Tests only read them. */
const baked: readonly Terrain[] = [sampleWorld(), randomWorld(lib, 7003), randomWorld(lib, 7011)].map((w) => bakeTerrain(w, lib));

/** A trail between every pair of regions, from points near their centers: far more trails than any budget allows. */
function everyPair(t: Terrain): TrailRequest[] {
  const ends: TrailEnd[] = t.spec.regions.map((r) => ({ id: r.id, x: r.x * 0.8, z: r.z * 0.8 }));
  const out: TrailRequest[] = [];
  for (let a = 0; a < ends.length; a++) {
    for (let b = a + 1; b < ends.length; b++) out.push({ id: `${a}-${b}`, from: ends[a] as TrailEnd, to: ends[b] as TrailEnd, style: STYLE, want: 1 - (a + b) / 20 });
  }
  return out;
}

// Some tests here bake a world or plan a network. Each takes up to a second alone, and several when other work shares the machine.
describe("trails", { timeout: 20_000 }, () => {
  // Planned once and only read.
  const planned = baked.map((t) => ({ t, network: planTrails(t, everyPair(t), 41) }));

  it("routes the same network for the same terrain, requests and seed", () => {
    const { network: na } = planned[0] as (typeof planned)[number];
    const b = bakeTerrain(sampleWorld(), lib);
    const nb = planTrails(b, everyPair(b), 41);
    expect(na.trails).toEqual(nb.trails);
    expect(na.ways.map((w) => Array.from(w.points))).toEqual(nb.ways.map((w) => Array.from(w.points)));
    expect(na.junctions).toEqual(nb.junctions);
  });

  it("walks every trail over one network of shared ways, chained from its first place to its second, or says why not", () => {
    for (const { t, network } of planned) {
      const requests = everyPair(t);
      expect(network.trails.length + network.dropped.length).toBe(requests.length);
      for (const d of network.dropped) expect(d.reason).not.toBe("");
      network.trails.forEach((tr, i) => {
        let at = tr.from;
        for (const step of tr.ways) {
          const w = network.ways[step.way] as Way;
          expect(step.reversed ? w.to : w.from).toBe(at);
          at = step.reversed ? w.from : w.to;
          expect(w.carries.some((c) => c.trail === i)).toBe(true);
        }
        expect(at).toBe(tr.to);
      });
    }
  });

  it("walks gentle, dry ground: no deep water and no steep climbs along the tread", () => {
    for (const { t, network } of planned) {
      for (const way of network.ways) {
        const p = way.points;
        for (let k = 0; k + 2 < p.length / 2; k++) {
          const [x, z] = [p[k * 2] as number, p[k * 2 + 1] as number];
          expect(waterDepthAt(t, x, z)).toBeLessThan(TRAILS.deep + 0.3);
          const run = Math.hypot((p[k * 2 + 4] as number) - x, (p[k * 2 + 5] as number) - z);
          const rise = Math.abs(heightAt(t.lattice, p[k * 2 + 4] as number, p[k * 2 + 5] as number) - heightAt(t.lattice, x, z));
          expect(rise / run).toBeLessThan(TRAILS.maxGrade * 1.8);
        }
      }
    }
  });

  it("crosses a stream on a bridge or stones wherever its tread crosses its water, each spanning the water from dry bank to dry bank", () => {
    /** Where two segments meet, if they do. */
    const meet = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): readonly [number, number] | null => {
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      if (den === 0) return null;
      const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
      const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
      return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [ax + (bx - ax) * u, az + (bz - az) * u] : null;
    };
    let crossings = 0;
    for (const { t, network } of planned) {
      for (const way of network.ways) {
        // Every point where the tread crosses a stream's course.
        const over: (readonly [number, number])[] = [];
        const p = way.points;
        for (let k = 0; k + 1 < p.length / 2; k++) {
          for (const stream of t.streams) {
            const st = stream.stations;
            for (let j = 0; j + 1 < st.length; j++) {
              const at = meet(p[k * 2]!, p[k * 2 + 1]!, p[k * 2 + 2]!, p[k * 2 + 3]!, st[j]!.x, st[j]!.z, st[j + 1]!.x, st[j + 1]!.z);
              if (at !== null) over.push(at);
            }
          }
        }
        const deck = (c: Crossing, s: number): readonly [number, number] => [c.x + Math.cos(-c.yaw) * s, c.z + Math.sin(-c.yaw) * s];
        const onDeck = (c: Crossing, [x, z]: readonly [number, number]): boolean => {
          const [ax, az] = deck(c, -c.span / 2);
          const [bx, bz] = deck(c, c.span / 2);
          const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (c.span * c.span)));
          return Math.hypot(x - (ax + (bx - ax) * u), z - (az + (bz - az) * u)) < 1.5;
        };
        // Check only where there is water to cross. A course's dry spring or seep needs no crossing.
        for (const at of over.filter((at) => waterDepthAt(t, ...at) > 0.1)) expect(way.crossings.some((c) => onDeck(c, at)), `${way.id} crosses a stream at ${at.map((v) => v.toFixed(1))} with nothing to cross on`).toBe(true);
        for (const c of way.crossings) {
          crossings++;
          const where = `${way.id}'s crossing at ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`;
          expect(over.some((at) => onDeck(c, at)), `${where} crosses a stream`).toBe(true);
          for (const end of [-c.span / 2, c.span / 2]) expect(waterDepthAt(t, ...deck(c, end)), `${where} ends on dry ground`).toBeLessThan(0.01);
          const depths = Array.from({ length: 21 }, (_, i) => waterDepthAt(t, ...deck(c, -c.span / 2 + (c.span * i) / 20)));
          expect(Math.max(...depths), `${where} spans water`).toBeGreaterThan(0.1);
        }
      }
    }
    expect(crossings).toBeGreaterThan(0);
  });

  it("wears a trail by the vitality of the entities it joins: bare between ones at high vitality, grown over toward one at low vitality", () => {
    const wear = 0.8;
    expect(trailWearAt(wear, 1, 1, 0.5)).toBeCloseTo(wear, 5);
    // Each end holds its own entity's vitality, and the wear runs smoothly between them, growing over toward the end at
    // low vitality.
    expect(trailWearAt(wear, 1, 0.05, 0)).toBeCloseTo(wear, 5);
    expect(trailWearAt(wear, 1, 0.05, 1)).toBeLessThan(trailWearAt(wear, 1, 0.05, 0));
    let before = Infinity;
    for (let a = 0; a <= 1; a += 0.01) {
      const w = trailWearAt(wear, 1, 0.05, a);
      expect(w).toBeLessThanOrEqual(before + 1e-9);
      expect(before === Infinity || before - w < wear * 0.1).toBe(true);
      before = w;
    }
    // A trail between entities at higher vitality is never less worn.
    for (let v = 0; v < 1; v += 0.05) expect(trailWearAt(wear, v + 0.05, v + 0.05, 0.5)).toBeGreaterThanOrEqual(trailWearAt(wear, v, v, 0.5) - 1e-9);
    expect(trailWearAt(wear, 1, 1, 0.5)).toBeGreaterThan(trailWearAt(wear, 0, 0, 0.5));
    // A way that several trails share wears by every trail walking it: never less than its most worn trail, grown over
    // only when all of them fail.
    const { network } = planned[0] as (typeof planned)[number];
    const shared = network.ways.findIndex((w) => w.carries.length >= 2);
    expect(shared).toBeGreaterThanOrEqual(0);
    const way = network.ways[shared] as Way;
    const lone = (keep: number): TrailNetwork => ({ ...network, ways: network.ways.map((w, i) => (i === shared ? { ...w, carries: [w.carries[keep] as WayCarry] } : w)) });
    const placesOf = (i: number): string[] => {
      const tr = network.trails[way.carries[i]?.trail ?? 0];
      return tr === undefined ? [] : [tr.from, tr.to];
    };
    const thriving = new Set(placesOf(0));
    // The first trail's entities have vitality 1, and every other entity 0.02.
    const vitality = (place: string): number => (thriving.has(place) ? 1 : 0.02);
    const both = wayWear(network, shared, vitality);
    const first = wayWear(lone(0), shared, vitality);
    both.forEach((w, s) => expect(w).toBeGreaterThanOrEqual((first[s] as number) - 1e-9));
    for (let a = 0; a <= 1; a += 0.1) expect(wayWearAt(both, a)).toBeGreaterThanOrEqual(wayWearAt(first, a) - 1e-9);
    // With every entity at vitality 0.02, the way grows over.
    const failing = wayWear(network, shared, () => 0.02);
    failing.forEach((w, s) => expect(w).toBeLessThan(both[s] as number));
    // A lone trail's way wears exactly as that trail does.
    const c = way.carries[0] as WayCarry;
    const tr = network.trails[c.trail]!;
    expect(wayWearAt(first, 0)).toBeCloseTo(trailWearAt(tr.style.wear, vitality(tr.from), vitality(tr.to), c.from), 5);
  });

});

describe("landmark sites", () => {
  it("stand on gentle, dry ground inside their own region, clear of what they avoid", () => {
    for (const t of baked) {
      const avoid = [{ x: 0, z: 0, radius: 40 }];
      t.spec.regions.forEach((_, r) => {
        const site = findLandmarkSite(t, r, 4, avoid);
        if (site === null) return;
        expect(site.region).toBe(r);
        expect(Math.hypot(site.x, site.z)).toBeGreaterThanOrEqual(44);
        expect(waterDepthAt(t, site.x, site.z)).toBe(0);
        expect(slopeAt(t.lattice, site.x, site.z)).toBeLessThan(6);
        expect(Math.abs(heightAt(t.lattice, site.x, site.z) - site.y)).toBeLessThan(0.05);
      });
    }
  });
});
