// What a person hears where they stand, as levels: each recording's level,
// side and tone from what the world says reaches them (`Earshot`). It reads
// no clock and plays nothing, so the same spot, hour and wind always sound
// the same, live or rendered from a recorded walk.
//
// The levels are the announcement film's Hush mix:
// the music at -21 LUFS and the world about ten decibels under it, each
// layer at the loudness it had in the film where it sounds.

import type { Earshot } from "../terrain/world.ts";

/** Each layer's loudness where it sounds, LUFS: the film's Hush mix. */
export const HUSH = {
  music: -21,
  wind: -34,
  gusts: -40,
  leaves: -42,
  stream: -35,
  mill: -39,
  birds: -44,
  evening: -46,
  crickets: -36,
  steps: -52,
  book: -38,
} as const;

/** The recordings that play all the time, rising and falling with where the person is. */
export const BEDS = ["wind", "gusts", "leaves", "stream", "mill", "birds", "evening", "crickets"] as const;
export type Bed = (typeof BEDS)[number];

/** One bed's level against its Hush loudness (1 is that loudness, 0 silent), its side (-1 left to 1 right) and how much of its top is cut, Hz. */
export interface Layer {
  readonly gain: number;
  readonly pan: number;
  readonly lowpass: number;
}

export type Mix = Readonly<Record<Bed, Layer>>;

const OPEN = 16000;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, v: number): number => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const db = (v: number): number => 10 ** (v / 20);

/**
 * A sound at a distance and bearing: louder near, by the inverse distance
 * from `near` meters (never louder than at `closest`); toward its side,
 * though never wholly in one ear; and duller behind.
 */
function placed(d: number, bearing: number, near: number, closest: number): Layer {
  const r = (bearing * Math.PI) / 180;
  return { gain: near / Math.max(d, closest), pan: Math.sin(r) * 0.6, lowpass: Math.cos(r) < 0 ? 5500 + 6500 * (1 + Math.cos(r)) : 12000 };
}

/**
 * How far the land around has failed, 0 to 1, from the decline the air
 * reads (`Earshot.decline`): the film's own reading, which heard full ruin
 * by 0.35, as round v1's house in the showcase.
 */
export const failing = (decline: number): number => smooth(0.12, 0.35, decline);

/** The most any bed rises over its Hush level, however near or strong: 6 dB. */
const CEILING = 2;

/** What the person hears where they stand. */
export function hear(e: Earshot): Mix {
  const mix = heard(e);
  return Object.fromEntries(BEDS.map((b) => [b, { ...mix[b], gain: Math.min(CEILING, mix[b].gain) }])) as Mix;
}

function heard(e: Earshot): Mix {
  const day = 1 - smooth(0.25, 0.6, e.night);
  const dark = smooth(0.35, 0.75, e.night);
  // Dusk: the blackbird's hour, between the day's birds and the crickets.
  const dusk = smooth(0.15, 0.4, e.night) * (1 - smooth(0.55, 0.8, e.night));
  const thriving = 1 - failing(e.decline);
  // The world rushing past, heard only while a trip carries the person faster than a walk.
  const rush = e.travelling ? smooth(5, 11, e.speed) : 0;
  // Wind follows the gust at the ear, a few decibels either way, and rises a little with height and while travelling.
  const gustDb = Math.min(3, Math.max(-4, 20 * Math.log10(Math.max(e.gust, 0.05) / 0.35) * 0.45));
  const windDb = gustDb + 4 * rush - 3 * e.canopy;
  const mid = { pan: 0, lowpass: OPEN };
  const silent = { gain: 0, pan: 0, lowpass: OPEN };
  const stream = e.stream === null ? silent : placed(e.stream.d, e.stream.bearing, 6, 3);
  const mill = e.mill === null ? silent : placed(e.mill.d, e.mill.bearing, 8, 4);
  return {
    // Dry wind over failing ground: the grass's top end goes with it.
    wind: { ...mid, gain: db(windDb), lowpass: 7000 + 9000 * thriving },
    gusts: { ...mid, gain: db(windDb) * thriving * (1 - e.canopy * 0.5) },
    leaves: { ...mid, gain: db(gustDb) * smooth(0.1, 0.6, e.canopy) * thriving },
    // A wider stream is a little louder: about 2 dB for each doubling of its width past four meters.
    stream: e.stream === null ? silent : { ...stream, gain: stream.gain * db(Math.min(4, Math.max(-6, 6.6 * Math.log10(e.stream.width / 4)))) },
    mill: e.mill === null ? silent : { ...mill, gain: mill.gain * e.mill.turning },
    birds: { ...mid, gain: day * thriving * (0.6 + 0.4 * e.canopy), lowpass: 9000 },
    evening: { ...mid, gain: dusk * thriving, lowpass: 9000 },
    crickets: { ...mid, gain: dark * (0.4 + 0.6 * thriving) },
  };
}

/** Footfalls a second at a pace, m/s: none standing still or while a trip carries the person, and quicker as they hurry. */
export function cadence(e: Pick<Earshot, "speed" | "travelling" | "underfoot" | "depth">): number {
  if (e.speed < 0.4 || e.travelling || e.depth > 0.6) return 0;
  return Math.min(3.6, 1.6 + 0.3 * e.speed);
}

/** What a footfall sounds on: a bridge's boards, dry straw where the ground has failed, or grass. */
export function footing(e: Pick<Earshot, "underfoot" | "decline">): "wood" | "dry" | "grass" {
  if (e.underfoot === "deck") return "wood";
  return failing(e.decline) > 0.5 ? "dry" : "grass";
}
