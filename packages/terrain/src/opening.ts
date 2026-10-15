// Where a person first stands in a world laid out from code, chosen by what
// they would see from there. A good first view is among the code, on dry
// ground on a stream's bank, looking downstream along water that runs on at
// least `OPENING.ahead` (or along a shorter stream whole), over ground that
// never rises in front of the eye to fill the view, with as much that stands
// for code in sight as the world offers. Every stretch of every stream among
// the code near the repository's own area is weighed so, from either bank,
// and the best view wins, the nearest that area's heart among equals. A world
// with no such stretch looks out the same way from dry ground around the
// heart. A person who was here before comes back to where they stood instead
// (`returnTo`), or beside the thing they stood by once an edit has moved it.

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
  /** How far downstream the person looks along, and so how much water must run on past where they stand, meters. */
  ahead: 30,
  /** Every this many of a stream's stations is a place to stand (they lie 2 to 3 m apart). */
  every: 3,
  /** Near the repository's own area: a bank at most this much farther from its heart than the nearest bank, meters. */
  nearer: 200,
  /** The view's half width, degrees, and how far into it what stands for code is counted, meters. */
  halfView: 35,
  sees: 100,
  /** A building or a landmark counts as this many of a tree, a bush, a stone or flowers. */
  tall: 4,
  /** The ground ahead may rise at most this many degrees above the eye, from `near` to `far` meters out: steeper fills the view. */
  rise: 4,
  near: 8,
  far: 120,
  /** With no stream among the code: rings around the repository's heart this far apart, out to `around`, each faced `ways` ways. */
  ring: 15,
  around: 120,
  ways: 12,
} as const;

/** Where a person first stands, and the way they face (the yaw a walk takes: 0 looks along -z). */
export interface OpeningSpot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** What stands for code on a world's land, where its layout put it: buildings and landmarks, and the definitions standing on their files' patches. */
export interface StandsForCode {
  readonly things: readonly { readonly x: number; readonly z: number }[];
  /** A definition with no form (`""`) stands as nothing. */
  readonly symbols: readonly { readonly x: number; readonly z: number; readonly form: string }[];
}

/** What a person sees from where they stand, facing a way. */
export interface OpeningView {
  /** The steepest the ground ahead rises above their eye, from `OPENING.near` to `OPENING.far` out, degrees: negative where it falls away. */
  readonly rise: number;
  /** What stands for code within `OPENING.sees` and the view's width, a building or landmark counting `OPENING.tall`. */
  readonly seen: number;
}

/** Whether a point lies among the code: on a file's patch or an area's own ground, never in the wild past them. */
export const amongCode = (places: WorldPlaces, x: number, z: number): boolean => placeAt(places, x, z).area.depth >= 0;

/** What a person standing at (x, z) and facing `yaw` sees. */
export function openingView(t: Terrain, code: StandsForCode, x: number, z: number, yaw: number): OpeningView {
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

/** Whether view `a` is better than `b`: open ground ahead first, then more that stands for code in sight, then nearer the repository's heart. */
function better(a: Weighed, b: Weighed): boolean {
  const openA = a.rise <= OPENING.rise;
  const openB = b.rise <= OPENING.rise;
  if (openA !== openB) return openA;
  if (a.seen !== b.seen) return a.seen > b.seen;
  return a.far < b.far;
}

export function openingSpot(t: Terrain, world: WorldPlaces & StandsForCode): OpeningSpot {
  const root = world.areas.find((a) => a.path === "") ?? { x: 0, z: 0 };
  const dryAmong = (x: number, z: number): boolean => amongCode(world, x, z) && waterDepthAt(t, x, z) <= OPENING.dry;
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
      // Only where the water runs on downstream far enough to look along it: past a stream's end there is no water to see.
      if (run === 0 || !amongCode(world, here.x, here.z) || Math.hypot(end.x - here.x, end.z - here.z) < run) continue;
      let ahead = k;
      while (Math.hypot((st[ahead] as typeof here).x - here.x, (st[ahead] as typeof here).z - here.z) < run) ahead++;
      const there = st[ahead] as typeof here;
      const along = Math.atan2(-(there.x - here.x), -(there.z - here.z));
      const out = surfaceHalfWidth(here) + OPENING.bank;
      // On either bank, facing the water downstream, so a stream that bends away still runs into the view.
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

/** What stands for code on a world's land by its identity, and the layout that placed it, for coming back to it. */
export interface CodeMarks {
  readonly size: number;
  readonly things: readonly { readonly path: string; readonly x: number; readonly z: number }[];
  readonly symbols: readonly { readonly id: string; readonly x: number; readonly z: number; readonly form: string }[];
  /** The land laid out under them: the same code lays out the same regions. */
  readonly regions: readonly unknown[];
}

/**
 * Where a person stood in a world when they last left it: their spot and the way they faced, the layout of the
 * world they stood in (`layoutKey`), and the nearest thing that stood for code, by its identity (an entity's or a
 * file's path, or a definition's `<file>#<name>`), with where it stood then.
 */
export interface StoodSpot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly layout: string;
  readonly by: { readonly path: string; readonly x: number; readonly z: number } | null;
}

/** Where a person comes back to: `exact` when the code is laid out as it was, so they stand where they stood. */
export interface Return {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly exact: boolean;
}

/** A key for a world's layout: the same code, laid out the same, gives the same key, and any edit that moves what stands or reshapes the land another. */
export function layoutKey(world: CodeMarks): string {
  // FNV-1a over the layout written out, to the centimeter.
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

/** What a person standing at (x, z) and facing `yaw` keeps of where they stood: see `StoodSpot`. */
export function stoodBy(world: CodeMarks, x: number, z: number, yaw: number): StoodSpot {
  let by: StoodSpot["by"] = null;
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
 * Where a person who stood at `stood` comes back to in `world`: exactly there while the code is laid out as it was;
 * once an edit has moved things, beside the thing they stood by wherever it stands now, at the same offset and
 * facing the same way, for the caller to check the ground there; null on a first visit, or when that thing is gone.
 */
export function returnTo(world: CodeMarks, stood: StoodSpot | undefined): Return | null {
  if (stood === undefined) return null;
  if (stood.layout === layoutKey(world)) return { x: stood.x, z: stood.z, yaw: stood.yaw, exact: true };
  if (stood.by === null) return null;
  const path = stood.by.path;
  const now = world.things.find((t) => t.path === path) ?? world.symbols.find((s) => s.id === path && s.form !== "");
  if (now === undefined) return null;
  return { x: now.x + (stood.x - stood.by.x), z: now.z + (stood.z - stood.by.z), yaw: stood.yaw, exact: false };
}
