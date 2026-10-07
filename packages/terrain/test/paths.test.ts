import { describe, expect, it } from "vitest";
import { Library, type RouteSpec } from "@gaia/schema";
import { BIOME_PRIMITIVES, RELIEF_PRIMITIVES } from "@gaia/primitives";
import {
  TRAILS,
  type Terrain,
  type TrailEnd,
  type TrailRequest,
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
  const planned = bake().map((t) => ({ t, trails: planTrails(t, everyPair(t), 41) }));

  it("routes the same trails for the same terrain, requests and seed", () => {
    const [a, b] = [bakeTerrain(sampleWorld(), lib), bakeTerrain(sampleWorld(), lib)] as [Terrain, Terrain];
    const ta = planTrails(a, everyPair(a), 41);
    const tb = planTrails(b, everyPair(b), 41);
    expect(ta.map((t) => t.id)).toEqual(tb.map((t) => t.id));
    expect(ta.map((t) => Array.from(t.points))).toEqual(tb.map((t) => Array.from(t.points)));
  });

  it("keeps every region within the composition budget, however many trails Jev wants", () => {
    for (const { t, trails } of planned) {
      expect(trails.length).toBeGreaterThan(0);
      const routes = t.spec.regions.map(() => 0);
      const tread = t.spec.regions.map(() => 0);
      for (const trail of trails) for (const r of trail.regions) routes[r] = (routes[r] ?? 0) + 1;
      const field = trailField(t, trails);
      const l = t.lattice;
      const area = t.spec.regions.map(() => 0);
      for (let i = 0; i < field.length; i++) {
        const x = l.origin + (i % l.n) * l.spacing;
        const z = l.origin + Math.floor(i / l.n) * l.spacing;
        if (Math.abs(x) > t.spec.size / 2 || Math.abs(z) > t.spec.size / 2) continue;
        const r = t.region[i] ?? 0;
        area[r] = (area[r] ?? 0) + 1;
        if ((field[i] as number) < 0) tread[r] = (tread[r] ?? 0) + 1;
      }
      routes.forEach((n) => expect(n).toBeLessThanOrEqual(TRAILS.routesPerRegion));
      // The tread's measured cover, with a little slack for where trails join and overlap.
      tread.forEach((n, r) => expect(n / (area[r] ?? 1)).toBeLessThanOrEqual(TRAILS.share * 1.1));
    }
  });

  it("walks gentle, dry ground: no deep water and no steep climbs along the tread", () => {
    for (const { t, trails } of planned) {
      for (const trail of trails) {
        const p = trail.points;
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

  it("knows, on every sample of a tread, which trail it is and how far along from its first end to its second", () => {
    const { t, trails } = planned[0] as (typeof planned)[number];
    const places = trailPlaces(t, trails);
    expect(Array.from(trailPlaces(t, trails))).toEqual(Array.from(places));
    const field = trailField(t, trails);
    const l = t.lattice;
    const sample = (x: number, z: number): number => Math.round((z - l.origin) / l.spacing) * l.n + Math.round((x - l.origin) / l.spacing);
    for (const [index, trail] of trails.entries()) {
      const [a, b] = trail.id.split("-").map(Number) as [number, number];
      expect([trail.from, trail.to]).toEqual([t.spec.regions[a]?.id, t.spec.regions[b]?.id]);
      const p = trail.points;
      const count = p.length / 2;
      // Along its own center line, away from where other trails join, it reads itself, rising from 0 to 1.
      let last = -1;
      for (let k = 0; k < count; k += 3) {
        const i = sample(p[k * 2] as number, p[k * 2 + 1] as number);
        if ((field[i] as number) >= 0) continue;
        const mine = [unpackPlace(places[i * 2] as number), unpackPlace(places[i * 2 + 1] as number)].find((q) => q?.trail === index);
        if (mine === undefined) continue;
        expect(Math.abs((mine as { along: number }).along - k / (count - 1))).toBeLessThan(0.05);
        expect((mine as { along: number }).along).toBeGreaterThanOrEqual(last - 0.02);
        last = (mine as { along: number }).along;
      }
      expect(last).toBeGreaterThan(0.8);
    }
    // Far from every trail, no sample names one.
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

  it("levels the ground only near a trail, and never by more than its limit", () => {
    const t = bakeTerrain(sampleWorld(), lib);
    const trails = planTrails(t, everyPair(t), 41);
    const before = t.lattice.heights.slice();
    const field = trailField(t, trails);
    levelTrails(t, trails);
    let moved = 0;
    for (let i = 0; i < before.length; i++) {
      const d = Math.abs((t.lattice.heights[i] as number) - (before[i] as number));
      if (d === 0) continue;
      moved++;
      expect(field[i] as number).toBeLessThanOrEqual(TRAILS.blend + 0.6);
      expect(d).toBeLessThanOrEqual(TRAILS.maxCut * trails.length + 1e-4);
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
