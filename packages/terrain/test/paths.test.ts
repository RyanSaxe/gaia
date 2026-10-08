import { describe, expect, it } from "vitest";
import { Library, type RouteSpec } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import {
  TRAILS,
  type Terrain,
  type TrailEnd,
  type TrailNetwork,
  type TrailRequest,
  type Way,
  type WayCarry,
  bakeTerrain,
  findLandmarkSite,
  heightAt,
  levelTrails,
  planTrails,
  randomWorld,
  sampleWorld,
  slopeAt,
  trailField,
  trailPlaces,
  trailWearAt,
  unpackPlace,
  waterDepthAt,
  wayWear,
  wayWearAt,
} from "@gaia/terrain";

const lib = new Library([...RELIEF_PRIMITIVES, ...BIOME_PRIMITIVES]);
const STYLE: RouteSpec = { width: 1.4, wear: 0.7, edging: "none", winding: 0.45, crossing: "footbridge" };
const bake = (): Terrain[] => [sampleWorld(), randomWorld(lib, 7003), randomWorld(lib, 7011)].map((w) => bakeTerrain(w, lib));

/** Every pair of region hearts, all wanted: far more trails than any budget allows. */
function everyPair(t: Terrain): TrailRequest[] {
  const ends: TrailEnd[] = t.spec.regions.map((r) => ({ id: r.id, x: r.x * 0.8, z: r.z * 0.8 }));
  const out: TrailRequest[] = [];
  for (let a = 0; a < ends.length; a++) {
    for (let b = a + 1; b < ends.length; b++) out.push({ id: `${a}-${b}`, from: ends[a] as TrailEnd, to: ends[b] as TrailEnd, style: STYLE, want: 1 - (a + b) / 20 });
  }
  return out;
}

describe("trails", () => {
  // Planned once: these worlds are only read.
  const planned = bake().map((t) => ({ t, network: planTrails(t, everyPair(t), 41) }));

  it("routes the same network for the same terrain, requests and seed", () => {
    const [a, b] = [bakeTerrain(sampleWorld(), lib), bakeTerrain(sampleWorld(), lib)] as [Terrain, Terrain];
    const na = planTrails(a, everyPair(a), 41);
    const nb = planTrails(b, everyPair(b), 41);
    expect(na.trails).toEqual(nb.trails);
    expect(na.ways.map((w) => Array.from(w.points))).toEqual(nb.ways.map((w) => Array.from(w.points)));
    expect(na.junctions).toEqual(nb.junctions);
  });

  it("walks every trail over one network of shared ways, chained from its first place to its second, or says why not", () => {
    for (const { t, network } of planned) {
      const requests = everyPair(t);
      expect(network.trails.length + network.dropped.length).toBe(requests.length);
      for (const d of network.dropped) expect(d.reason.length).toBeGreaterThan(10);
      expect(network.trails.length).toBeGreaterThan(requests.length / 2);
      // Shared ways: the tread is far shorter than the trails walked.
      const tread = network.ways.reduce((n, w) => n + w.length, 0);
      const walked = network.trails.reduce((n, tr) => n + tr.length, 0);
      expect(tread).toBeLessThan(walked * 0.6);
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
      // Junctions join three ways or more.
      for (const j of network.junctions) expect(j.ways.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("never runs two ways side by side", () => {
    for (const { network } of planned) {
      for (const [i, w] of network.ways.entries()) {
        const p = w.points;
        const count = p.length / 2;
        let interior = 0;
        let beside = 0;
        for (let k = 10; k < count - 10; k += 2) {
          interior++;
          const [x, z] = [p[k * 2] as number, p[k * 2 + 1] as number];
          const close = network.ways.some((o, j) => {
            if (j === i) return false;
            for (let m = 0; m < o.points.length; m += 2) if (Math.hypot((o.points[m] as number) - x, (o.points[m + 1] as number) - z) < (w.style.width + o.style.width) / 2 + 1.5) return true;
            return false;
          });
          if (close) beside++;
        }
        // Where two ways cross there is a meter or two of closeness; never a long run.
        expect(beside).toBeLessThanOrEqual(Math.max(3, interior * 0.08));
      }
    }
  });

  it("keeps the network's ground within the composition budget, however many trails Jev wants", () => {
    for (const { t, network } of planned) {
      const field = trailField(t, network.ways);
      const l = t.lattice;
      const area = t.spec.regions.map(() => 0);
      const tread = t.spec.regions.map(() => 0);
      for (let i = 0; i < field.length; i++) {
        const x = l.origin + (i % l.n) * l.spacing;
        const z = l.origin + Math.floor(i / l.n) * l.spacing;
        if (Math.abs(x) > t.spec.size / 2 || Math.abs(z) > t.spec.size / 2) continue;
        const r = t.region[i] ?? 0;
        area[r] = (area[r] ?? 0) + 1;
        if ((field[i] as number) < 0) tread[r] = (tread[r] ?? 0) + 1;
      }
      // The tread's measured cover, with a little slack for where ways meet.
      tread.forEach((n, r) => expect(n / (area[r] ?? 1)).toBeLessThanOrEqual(TRAILS.share * 1.15));
      const all = tread.reduce((a, b) => a + b, 0) / area.reduce((a, b) => a + b, 0);
      expect(all).toBeLessThanOrEqual(TRAILS.landShare * 1.15);
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

  it("knows, on every sample of a tread, which way it is and how far along from its first point to its last", () => {
    const { t, network } = planned[0] as (typeof planned)[number];
    const places = trailPlaces(t, network.ways);
    expect(Array.from(trailPlaces(t, network.ways))).toEqual(Array.from(places));
    const field = trailField(t, network.ways);
    const l = t.lattice;
    const sample = (x: number, z: number): number => Math.round((z - l.origin) / l.spacing) * l.n + Math.round((x - l.origin) / l.spacing);
    for (const [index, way] of network.ways.entries()) {
      const p = way.points;
      const count = p.length / 2;
      if (count < 30) continue;
      // Along its own center line, away from where other ways meet it, it reads itself, rising from 0 to 1.
      let last = -1;
      for (let k = 0; k < count; k += 3) {
        const i = sample(p[k * 2] as number, p[k * 2 + 1] as number);
        if ((field[i] as number) >= 0) continue;
        const mine = [unpackPlace(places[i * 2] as number), unpackPlace(places[i * 2 + 1] as number)].find((q) => q?.way === index);
        if (mine === undefined) continue;
        expect(Math.abs((mine as { along: number }).along - k / (count - 1))).toBeLessThan(0.05);
        expect((mine as { along: number }).along).toBeGreaterThanOrEqual(last - 0.02);
        last = (mine as { along: number }).along;
      }
      expect(last).toBeGreaterThan(0.8);
    }
    // Far from every way, no sample names one.
    for (let i = 0; i < field.length; i += 97) if ((field[i] as number) >= TRAILS.reach) expect(places[i * 2]).toBe(-1);
  });

  it("wears a trail by the vitality of the entities it joins: bare between thriving ones, grown over toward a failing one", () => {
    const wear = 0.8;
    expect(trailWearAt(wear, 1, 1, 0.5)).toBeCloseTo(wear, 5);
    // Each end holds its own entity's vitality, and the wear runs smoothly between them.
    expect(trailWearAt(wear, 1, 0.05, 0)).toBeCloseTo(wear, 5);
    expect(trailWearAt(wear, 1, 0.05, 1)).toBeLessThan(wear * 0.25);
    let before = Infinity;
    for (let a = 0; a <= 1; a += 0.05) {
      const w = trailWearAt(wear, 1, 0.05, a);
      expect(w).toBeLessThanOrEqual(before + 1e-9);
      expect(before === Infinity || before - w < 0.16).toBe(true);
      before = w;
    }
    // A failing pair leaves a faint trace, never nothing, so the route still reads.
    expect(trailWearAt(wear, 0, 0, 0.5)).toBeGreaterThan(0);
    expect(trailWearAt(wear, 0.5, 0.5, 0.5)).toBeGreaterThan(trailWearAt(wear, 0.1, 0.1, 0.5));
  });

  it("wears a shared way by every trail walking it: never less than its most worn trail, grown over only when all of them fail", () => {
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
    // The first trail's entities thrive; every other entity fails.
    const vitality = (place: string): number => (thriving.has(place) ? 1 : 0.02);
    const both = wayWear(network, shared, vitality);
    const first = wayWear(lone(0), shared, vitality);
    both.forEach((w, s) => expect(w).toBeGreaterThanOrEqual((first[s] as number) - 1e-9));
    for (let a = 0; a <= 1; a += 0.1) expect(wayWearAt(both, a)).toBeGreaterThanOrEqual(wayWearAt(first, a) - 1e-9);
    // With every entity failing, the way grows over.
    const failing = wayWear(network, shared, () => 0.02);
    failing.forEach((w, s) => expect(w).toBeLessThan(both[s] as number));
    // A lone trail's way wears exactly as that trail does.
    const c = way.carries[0] as WayCarry;
    const tr = network.trails[c.trail]!;
    expect(wayWearAt(first, 0)).toBeCloseTo(trailWearAt(tr.style.wear, vitality(tr.from), vitality(tr.to), c.from), 5);
  });

  it("levels the ground only near a way, and never by more than its limit", () => {
    const t = bakeTerrain(sampleWorld(), lib);
    const network = planTrails(t, everyPair(t), 41);
    const before = t.lattice.heights.slice();
    const field = trailField(t, network.ways);
    levelTrails(t, network.ways);
    let moved = 0;
    for (let i = 0; i < before.length; i++) {
      const d = Math.abs((t.lattice.heights[i] as number) - (before[i] as number));
      if (d === 0) continue;
      moved++;
      expect(field[i] as number).toBeLessThanOrEqual(TRAILS.blend + 0.6);
      // Where ways meet each may ease the same ground, but never far.
      expect(d).toBeLessThanOrEqual(TRAILS.maxCut * 3 + 1e-4);
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe("landmark sites", () => {
  it("stand on gentle, dry ground inside their own region, clear of what they avoid", () => {
    for (const t of bake()) {
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
