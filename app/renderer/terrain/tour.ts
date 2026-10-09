// The places worth seeing in a world, for anyone testing a feature: every
// building and landmark by its kind and health, the healthiest and the most
// ruined footbridge, stepping stones and cairn, ponds, groves and areas from
// thriving to failing, the largest, the smallest and the most deeply nested.
// Each stop says where to stand and which way to look. Found from the world
// as it stands, so any world has a tour; the proving ground (`?world=proving`)
// is built to have every stop.

import type { Junction, TrailNetwork } from "@gaia/terrain";

/** A building or landmark standing for an entity. */
export interface TourThing {
  readonly as: "building" | "landmark";
  /** Its kind, such as "Watermill". */
  readonly kind: string;
  /** The entity it stands for. */
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly vitality: number;
  /** How far it reaches from its middle, meters. */
  readonly reach: number;
  /** The way its front faces, for a building: a unit vector. */
  readonly front?: { readonly x: number; readonly z: number };
}

/** An area of a codebase's world: its heart, its ground and its own ground's vitality. */
export interface TourArea {
  readonly path: string;
  readonly x: number;
  readonly z: number;
  readonly ground: number;
  readonly depth: number;
  readonly vitality: number;
}

/** A file's grove: the middle of its trees, how many there are, and its file's vitality. */
export interface TourGrove {
  readonly path: string;
  readonly x: number;
  readonly z: number;
  readonly trees: number;
  readonly vitality: number;
}

export interface TourWorld {
  readonly things: readonly TourThing[];
  readonly network: TrailNetwork;
  /** A way's vitality at a point along it, 0 to 1 from its first point to its last. */
  readonly wayVitality: (way: number, along: number) => number;
  readonly junctionVitality: (junction: Junction) => number;
  /** A codebase's areas; none for the sample world. */
  readonly areas: readonly TourArea[];
  readonly groves: readonly TourGrove[];
  readonly ponds: readonly { readonly x: number; readonly z: number; readonly reach: number }[];
  /** Whether a person can stand at (x, z): dry and clear of anything solid. */
  readonly standable: (x: number, z: number) => boolean;
}

/** Where to stand to see one thing, and which way to look. */
export interface TourStop {
  /** Its name in the tour, such as "watermill (ruin)" or "stepping stones". */
  readonly name: string;
  /** What is there, in words. */
  readonly what: string;
  readonly x: number;
  readonly z: number;
  /** Which way to look, as the walk's yaw and pitch, radians. */
  readonly yaw: number;
  readonly pitch: number;
  /** What the stop looks at. */
  readonly at: { readonly x: number; readonly z: number };
}

/** Health in words, by vitality. */
export const healthOf = (v: number): string => (v >= 0.85 ? "thriving" : v >= 0.6 ? "well" : v >= 0.35 ? "tired" : v >= 0.12 ? "failing" : "ruin");

const DEG = Math.PI / 180;
const yawToward = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));

/** The first standable spot `distance` from (tx, tz), trying `prefer`'s side first and turning from it, a little nearer and farther. */
function viewpoint(w: TourWorld, tx: number, tz: number, distance: number, prefer: number): { x: number; z: number } {
  for (const d of [distance, distance * 1.3, distance * 0.75, distance * 1.7]) {
    for (let k = 0; k < 24; k++) {
      const a = prefer + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 15 * DEG;
      const x = tx + Math.cos(a) * d;
      const z = tz + Math.sin(a) * d;
      if (w.standable(x, z)) return { x, z };
    }
  }
  return { x: tx + Math.cos(prefer) * distance, z: tz + Math.sin(prefer) * distance };
}

/** The side to look from by default: from the world's middle, so the view looks outward across the thing. */
const outward = (x: number, z: number): number => (Math.hypot(x, z) < 1 ? 0 : Math.atan2(z, x));

function stop(name: string, what: string, from: { x: number; z: number }, at: { x: number; z: number }, pitchDeg: number): TourStop {
  return { name, what, x: from.x, z: from.z, yaw: yawToward(from.x, from.z, at.x, at.z), pitch: pitchDeg * DEG, at: { x: at.x, z: at.z } };
}

/** Every stop in a world: the things by kind and health, then crossings, cairns, ponds, groves and areas. */
export function tourStops(w: TourWorld): TourStop[] {
  const stops: TourStop[] = [];
  const named = new Map<string, number>();
  const add = (s: TourStop): void => {
    const n = (named.get(s.name) ?? 0) + 1;
    named.set(s.name, n);
    stops.push(n === 1 ? s : { ...s, name: `${s.name} ${n}` });
  };

  // Each building from in front of it, each landmark from a little farther, looking up at it.
  const seeThing = (t: TourThing): TourStop => {
    const prefer = t.front === undefined ? outward(t.x, t.z) : Math.atan2(t.front.z, t.front.x);
    const from = viewpoint(w, t.x, t.z, t.reach + (t.as === "building" ? 10 : 14), prefer);
    return stop(`${t.kind.toLowerCase()} (${healthOf(t.vitality)})`, `${t.kind} for ${t.name}, vitality ${t.vitality.toFixed(2)}`, from, t, t.as === "building" ? 4 : 9);
  };
  const things = [...w.things].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : b.vitality - a.vitality));
  for (const t of things) add(seeThing(t));
  for (const as of ["building", "landmark"] as const) {
    const all = w.things.filter((t) => t.as === as).sort((a, b) => a.vitality - b.vitality);
    const worst = all[0];
    const best = all[all.length - 1];
    if (worst !== undefined && worst.vitality < 0.35) add({ ...seeThing(worst), name: `ruined ${as}` });
    if (best !== undefined && best.vitality >= 0.85) add({ ...seeThing(best), name: `thriving ${as}` });
  }

  // Each crossing from its way, a few meters back along the trail, looking across.
  const crossings = w.network.ways.flatMap((way, i) =>
    way.crossings.map((c) => {
      const pts = way.points;
      const count = pts.length / 2;
      let k = 0;
      for (let j = 0; j < count; j++) if (Math.hypot((pts[j * 2] as number) - c.x, (pts[j * 2 + 1] as number) - c.z) < Math.hypot((pts[k * 2] as number) - c.x, (pts[k * 2 + 1] as number) - c.z)) k = j;
      const along = count < 2 ? 0.5 : k / (count - 1);
      const back = Math.round(c.span / 2 + 7);
      const candidates = [k - back, k + back].filter((j) => j >= 0 && j < count).map((j) => ({ x: pts[j * 2] as number, z: pts[j * 2 + 1] as number }));
      const from = candidates.find((p) => w.standable(p.x, p.z)) ?? candidates[0] ?? viewpoint(w, c.x, c.z, c.span, outward(c.x, c.z));
      return { kind: way.style.crossing, vitality: w.wayVitality(i, along), from, at: c, span: c.span };
    }),
  );
  for (const kind of ["footbridge", "stepping-stones"] as const) {
    const all = crossings.filter((c) => c.kind === kind).sort((a, b) => b.vitality - a.vitality);
    const label = kind === "footbridge" ? "bridge" : "stepping stones";
    const what = (c: (typeof all)[number]): string => `${kind === "footbridge" ? "A footbridge" : "Stepping stones"} across ${c.span.toFixed(0)} m of water, vitality ${c.vitality.toFixed(2)}`;
    const best = all[0];
    const worst = all[all.length - 1];
    if (best !== undefined) add(stop(label, what(best), best.from, best.at, -6));
    if (worst !== undefined && worst !== best && worst.vitality < 0.35) add(stop(`ruined ${label}`, what(worst), worst.from, worst.at, -6));
  }

  // A junction's cairn, close enough to see its stones.
  const cairns = w.network.junctions.flatMap((j) => (j.cairn === null ? [] : [{ at: j.cairn, vitality: w.junctionVitality(j), ways: j.ways.length }])).sort((a, b) => b.vitality - a.vitality);
  const cairnStop = (c: (typeof cairns)[number], name: string): TourStop => stop(name, `A cairn where ${c.ways} ways meet, vitality ${c.vitality.toFixed(2)}`, viewpoint(w, c.at.x, c.at.z, 5, outward(c.at.x, c.at.z)), c.at, -16);
  const bestCairn = cairns[0];
  const worstCairn = cairns[cairns.length - 1];
  if (bestCairn !== undefined) add(cairnStop(bestCairn, "cairn"));
  if (worstCairn !== undefined && worstCairn !== bestCairn && worstCairn.vitality < 0.35) add(cairnStop(worstCairn, "ruined cairn"));

  for (const p of w.ponds) add(stop("pond", `A pond ${(p.reach * 2).toFixed(0)} m across`, viewpoint(w, p.x, p.z, p.reach + 5, outward(p.x, p.z)), p, -4));

  // The largest thriving grove and the largest failing one.
  const groveStop = (g: TourGrove, name: string): TourStop => stop(name, `${g.trees} trees on ${g.path}, vitality ${g.vitality.toFixed(2)}`, viewpoint(w, g.x, g.z, 22, outward(g.x, g.z)), g, 6);
  const largest = (groves: readonly TourGrove[]): TourGrove | undefined => [...groves].sort((a, b) => b.trees - a.trees || (a.path < b.path ? -1 : 1))[0];
  const thrivingGrove = largest(w.groves.filter((g) => g.vitality >= 0.85));
  const failingGrove = largest(w.groves.filter((g) => g.vitality < 0.35));
  if (thrivingGrove !== undefined) add(groveStop(thrivingGrove, "thriving grove"));
  if (failingGrove !== undefined) add(groveStop(failingGrove, "failing grove"));

  // Areas: the healthiest and the most failing of any size, the largest, the smallest and the most deeply nested.
  const areaStop = (a: TourArea, name: string): TourStop => stop(name, `${a.path === "" ? "The repository's root" : a.path}: ${Math.round(a.ground).toLocaleString("en-US")} m², ${a.depth} deep, vitality ${a.vitality.toFixed(2)}`, viewpoint(w, a.x, a.z, 30, outward(a.x, a.z)), a, 2);
  const sizable = w.areas.filter((a) => a.depth === 1).sort((a, b) => b.vitality - a.vitality || b.ground - a.ground);
  const pick: [string, TourArea | undefined][] = [
    ["thriving area", sizable[0]],
    ["failing area", sizable[sizable.length - 1]?.vitality !== undefined && (sizable[sizable.length - 1]?.vitality ?? 1) < 0.35 ? sizable[sizable.length - 1] : undefined],
    ["large area", [...w.areas].filter((a) => a.depth === 1).sort((a, b) => b.ground - a.ground)[0]],
    ["tiny area", [...w.areas].filter((a) => a.depth >= 1).sort((a, b) => a.ground - b.ground)[0]],
    ["deep nesting", [...w.areas].sort((a, b) => b.depth - a.depth || a.ground - b.ground)[0]],
  ];
  for (const [name, a] of pick) if (a !== undefined) add(areaStop(a, name));
  return stops;
}
