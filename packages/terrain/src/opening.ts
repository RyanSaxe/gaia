// Chooses where a person first stands in a world laid out from code, by what
// they would see. It weighs spots on stream banks among the code near the
// repository's area, looking downstream over open ground at as much code as
// possible, and falls back to dry ground around the area's center. A returning
// person goes back to where they stood (`returnTo`), or beside the thing they
// stood by once an edit has moved it.

import type { WorldPlaces } from "@gaia/schema";
import { heightAt } from "./lattice.ts";
import { placeAt } from "./places.ts";
import { EYE_HEIGHT } from "./sight.ts";
import { waterDepthAt } from "./walk.ts";
import { surfaceHalfWidth } from "./water.ts";
import type { Terrain } from "./world.ts";

export const OPENING = {
  /** How far past the water's edge the person stands, meters. */
  bank: 2.5,
  /** The deepest water that counts as dry ground, meters. */
  dry: 0.02,
  /** Meters downstream the person looks, which is how much stream must continue past where they stand. */
  ahead: 30,
  /** Every this-many-th station of a stream is a candidate spot. Stations are 2 to 3 m apart. */
  every: 3,
  /** A bank counts as near the repository's area when it is at most this many meters farther from the area's center than the nearest bank. */
  nearer: 200,
  /** The view's half width in degrees (`halfView`), and the distance in meters within which code in view is counted (`sees`). */
  halfView: 35,
  sees: 100,
  /** A building or a landmark counts as this many of a tree, a bush, a stone or flowers. */
  tall: 4,
  /** The most degrees the ground ahead may rise above the eye, from `near` to `far` meters out. Steeper ground fills the view. */
  rise: 4,
  near: 8,
  far: 120,
  /**
   * Meters the spot keeps from everything that represents code: `clear` from each shown definition, file or entity,
   * and `pastLot` past a building's or landmark's lot, so turning around never fills the view with one.
   */
  clear: 6,
  pastLot: 3,
  /** Without a stream among the code, spots lie on rings `ring` meters apart around the repository area's center, out to `around`, each tried in `ways` directions. */
  ring: 15,
  around: 120,
  ways: 12,
} as const;

/** Where a person first stands and their yaw, as a walk takes it, where 0 looks along -z. */
export interface OpeningSpot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** The positions of everything that represents code on a world's land: buildings and landmarks, definitions on their files' patches, and files and entities shown as plants or stones. */
export interface CodePositions {
  /** Buildings and landmarks, each with its lot's radius. The sample world's have none. */
  readonly things: readonly { readonly x: number; readonly z: number; readonly lot?: number }[];
  /** Definitions. One with no form (`""`) is not shown. */
  readonly symbols: readonly { readonly x: number; readonly z: number; readonly form: string }[];
  /** Files and entities shown as flowers, a stone, a bush or a tree. */
  readonly plants?: readonly { readonly x: number; readonly z: number }[];
}

/** Whether (x, z) is clear of everything that represents code (`OPENING.clear`). */
export function clearOfCode(code: CodePositions, x: number, z: number): boolean {
  for (const t of code.things) if (Math.hypot(t.x - x, t.z - z) < (t.lot ?? 0) + OPENING.pastLot) return false;
  for (const s of code.symbols) if (s.form !== "" && Math.hypot(s.x - x, s.z - z) < OPENING.clear) return false;
  for (const s of code.plants ?? []) if (Math.hypot(s.x - x, s.z - z) < OPENING.clear) return false;
  return true;
}

/** What a person sees from a spot, facing one direction. */
export interface OpeningView {
  /** The steepest angle in degrees at which the ground ahead rises above the eye, from `OPENING.near` to `OPENING.far` out. Negative where it falls away. */
  readonly rise: number;
  /** A count of the things and definitions within `OPENING.sees` and the view's width, with a building or landmark counting `OPENING.tall`. */
  readonly seen: number;
}

/** Whether a point lies on a file's patch or an area's own ground, not in the wild past them. */
export const amongCode = (places: WorldPlaces, x: number, z: number): boolean => placeAt(places, x, z).area.depth >= 0;

/** What a person standing at (x, z) and facing `yaw` sees. */
export function openingView(t: Terrain, code: CodePositions, x: number, z: number, yaw: number): OpeningView {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const eye = heightAt(t.lattice, x, z) + EYE_HEIGHT;
  let rise = -90;
  for (let d = OPENING.near; d <= OPENING.far; d += 4) rise = Math.max(rise, (Math.atan2(heightAt(t.lattice, x + fx * d, z + fz * d) - eye, d) * 180) / Math.PI);
  const cos = Math.cos((OPENING.halfView * Math.PI) / 180);
  const inView = (p: { readonly x: number; readonly z: number }): boolean => {
    const d = Math.hypot(p.x - x, p.z - z);
    return d > 0 && d <= OPENING.sees && ((p.x - x) * fx + (p.z - z) * fz) / d >= cos;
  };
  let seen = 0;
  for (const p of code.things) if (inView(p)) seen += OPENING.tall;
  for (const p of code.symbols) if (p.form !== "" && inView(p)) seen++;
  return { rise, seen };
}

type Weighed = OpeningSpot & OpeningView & { readonly far: number };

/** Whether view `a` beats `b`: open ground ahead first, then more code in view, then nearer the repository area's center. */
function better(a: Weighed, b: Weighed): boolean {
  const openA = a.rise <= OPENING.rise;
  const openB = b.rise <= OPENING.rise;
  if (openA !== openB) return openA;
  if (a.seen !== b.seen) return a.seen > b.seen;
  return a.far < b.far;
}

export function openingSpot(t: Terrain, world: WorldPlaces & CodePositions): OpeningSpot {
  const root = world.areas.find((a) => a.path === "") ?? { x: 0, z: 0 };
  // Dry ground among the code, clear of everything that represents code.
  const dryAmong = (x: number, z: number): boolean => amongCode(world, x, z) && waterDepthAt(t, x, z) <= OPENING.dry && clearOfCode(world, x, z);
  let best: Weighed | null = null;
  const weigh = (x: number, z: number, yaw: number): void => {
    const view: Weighed = { x, z, yaw, ...openingView(t, world, x, z, yaw), far: Math.hypot(x - root.x, z - root.z) };
    if (best === null || better(view, best)) best = view;
  };
  const banks: OpeningSpot[] = [];
  for (const stream of t.streams) {
    const st = stream.stations;
    const start = st[0];
    const end = st[st.length - 1];
    if (start === undefined || end === undefined) continue;
    // A stream shorter than `OPENING.ahead` is looked along whole, from its spring.
    const run = Math.min(OPENING.ahead, Math.hypot(end.x - start.x, end.z - start.z));
    for (let k = 0; k < st.length; k += OPENING.every) {
      const here = st[k] as (typeof st)[number];
      // Skip stations without `run` meters of stream left downstream to look along.
      if (run === 0 || !amongCode(world, here.x, here.z) || Math.hypot(end.x - here.x, end.z - here.z) < run) continue;
      let ahead = k;
      while (Math.hypot((st[ahead] as typeof here).x - here.x, (st[ahead] as typeof here).z - here.z) < run) ahead++;
      const there = st[ahead] as typeof here;
      const along = Math.atan2(-(there.x - here.x), -(there.z - here.z));
      const out = surfaceHalfWidth(here) + OPENING.bank;
      // Try both banks, each facing the point `run` downstream, so a stream that bends away still runs into the view.
      for (const side of [1, -1]) {
        const x = here.x + Math.cos(along) * out * side;
        const z = here.z - Math.sin(along) * out * side;
        if (dryAmong(x, z)) banks.push({ x, z, yaw: Math.atan2(-(there.x - x), -(there.z - z)) });
      }
    }
  }
  const nearest = Math.min(...banks.map((b) => Math.hypot(b.x - root.x, b.z - root.z)));
  for (const b of banks) if (Math.hypot(b.x - root.x, b.z - root.z) <= nearest + OPENING.nearer) weigh(b.x, b.z, b.yaw);
  if (best === null) {
    for (let r = 0; r <= OPENING.around; r += OPENING.ring) {
      const count = r === 0 ? 1 : Math.round((Math.PI * 2 * r) / OPENING.ring);
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        const x = root.x + Math.cos(a) * r;
        const z = root.z + Math.sin(a) * r;
        if (dryAmong(x, z)) for (let w = 0; w < OPENING.ways; w++) weigh(x, z, (w / OPENING.ways) * Math.PI * 2);
      }
    }
  }
  const chosen = best as Weighed | null;
  return chosen === null ? { x: root.x, z: root.z, yaw: 0 } : { x: chosen.x, z: chosen.z, yaw: chosen.yaw };
}

/** Everything that represents code on a world's land, by identity, and the layout that placed it, for returning to a spot. */
export interface CodeMarks {
  readonly size: number;
  readonly things: readonly { readonly path: string; readonly x: number; readonly z: number }[];
  readonly symbols: readonly { readonly id: string; readonly x: number; readonly z: number; readonly form: string }[];
  /** The land's regions under them. The same code lays out the same regions. */
  readonly regions: readonly unknown[];
}

/**
 * Where a person stood in a world when they last left it: their spot and yaw, the world's layout (`layoutKey`), and
 * the nearest thing that represents code with its position then. That thing's `path` is an entity's or file's path,
 * or a definition's `<file>#<name>`.
 */
export interface LastSpot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly layout: string;
  readonly by: { readonly path: string; readonly x: number; readonly z: number } | null;
}

/** Where a returning person stands. `exact` is true when the code's layout is unchanged, so they stand where they stood. */
export interface Return {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly exact: boolean;
}

/** A key for a world's layout. The same layout gives the same key, and an edit that moves anything or reshapes the land gives a different one. */
export function layoutKey(world: CodeMarks): string {
  // FNV-1a over the layout as text, with positions to the centimeter.
  let h = 0x811c9dc5;
  const add = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  };
  const at = (x: number, z: number): string => `${Math.round(x * 100)},${Math.round(z * 100)};`;
  add(`${world.size};`);
  for (const t of world.things) add(t.path + at(t.x, t.z));
  for (const s of world.symbols) add(s.id + at(s.x, s.z));
  add(JSON.stringify(world.regions));
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The `LastSpot` to save for a person at (x, z) facing `yaw`. */
export function lastSpotAt(world: CodeMarks, x: number, z: number, yaw: number): LastSpot {
  let by: LastSpot["by"] = null;
  let nearest = Infinity;
  const consider = (path: string, px: number, pz: number): void => {
    const d = Math.hypot(px - x, pz - z);
    if (d < nearest) [nearest, by] = [d, { path, x: px, z: pz }];
  };
  for (const t of world.things) consider(t.path, t.x, t.z);
  for (const s of world.symbols) if (s.form !== "") consider(s.id, s.x, s.z);
  return { x, z, yaw, layout: layoutKey(world), by };
}

/**
 * Where a person who stood at `stood` returns to in `world`. While the code's layout is unchanged it is exactly there.
 * Once an edit has moved things, it is beside the thing they stood by at its new position, at the same offset and
 * facing the same way, and the caller checks the ground there. Returns null on a first visit or when that thing is gone.
 */
export function returnTo(world: CodeMarks, stood: LastSpot | undefined): Return | null {
  if (stood === undefined) return null;
  if (stood.layout === layoutKey(world)) return { x: stood.x, z: stood.z, yaw: stood.yaw, exact: true };
  if (stood.by === null) return null;
  const path = stood.by.path;
  const now = world.things.find((t) => t.path === path) ?? world.symbols.find((s) => s.id === path && s.form !== "");
  if (now === undefined) return null;
  return { x: now.x + (stood.x - stood.by.x), z: now.z + (stood.z - stood.by.z), yaw: stood.yaw, exact: false };
}
