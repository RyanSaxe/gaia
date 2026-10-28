// Plays the game's score, the film's storybook chamber music, for open play
// instead of timed to a cut. It has three plans, and the game uses `layers`:
//   phrases  a short phrase now and then, chosen by the hour and the land,
//            with only the world's sounds between.
//   loop     one piece looping, with its night colour fading in after dark.
//   layers   the same piece's parts fading in and out: the theme on some
//            passes and not others, the night colour after dark, and a minor
//            harmony where `failing` rises.
// It schedules on the audio context's clock, so it plays the same live and
// when rendered offline from a recorded walk.

import type { Earshot } from "../terrain/world.ts";
import { HUSH, failing } from "./hearing.ts";
import type { Shelf } from "./shelf.ts";

export type MusicPlan = "phrases" | "loop" | "layers";
export const STEMS = ["bed", "melody", "shimmer", "minor"] as const;
export type Stem = (typeof STEMS)[number];
export const PHRASES = ["day-1", "day-2", "day-3", "day-4", "night-1", "night-2", "ruin-1"] as const;
export type Phrase = (typeof PHRASES)[number];
/** When a phrase fits: `ruin` where `failing` of the land's decline is above 0.5, otherwise `night` or `day` by darkness. */
export type Moment = "day" | "night" | "ruin";

/** A chunk of one part of the piece, named by the part and the chunk's index from 0. */
export type Chunk = `${Stem}:${number}`;

/**
 * The score's recordings: the piece's parts, streamed a chunk at a time and all
 * cut at the same bars so they loop together, and the phrases, each decoded
 * while it plays.
 */
export interface MusicBank {
  readonly chunks: Shelf<Chunk>;
  /** The piece's chunk count, each chunk's length, and the unplayed audio decoded on either side of a chunk, in seconds. */
  readonly chunk: { readonly count: number; readonly seconds: number; readonly margin: number };
  readonly phrases: Shelf<Phrase>;
  /** The loudness in LUFS of the whole piece, bed and melody together, and of the phrases, so both play at the Hush mix's -21 LUFS. */
  readonly lufs: { readonly piece: number; readonly phrases: number };
}

export interface Music {
  /** Updates the music for what the person hears at time `t`, in seconds on the context's clock. */
  at(t: number, ear: Earshot): void;
}

const db = (v: number): number => 10 ** (v / 20);
const smooth = (e0: number, e1: number, v: number): number => {
  const c = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return c * c * (3 - 2 * c);
};
/** The time constant in seconds for a part fading in or out. */
const SWELL = 4;
/** The minor bed is darker and sparser, 2.7 dB under the bed. This many dB of that are added back, so low-vitality land never sounds like the music dropping out. */
const MINOR_LIFT = 2;
/** Seconds after which an unwanted part stops and releases its recording. */
const RELEASE = 60;
/**
 * Seconds before a chunk plays that it is requested, to be scheduled once
 * decoded. A chunk that is ready with less than `JOIN_BEFORE` seconds of it
 * left is skipped for the next one.
 */
const AHEAD = 4;
const JOIN_BEFORE = 1;
/** For `phrases`: seconds from the start to the first phrase, and the range of rest between one phrase's end and the next. */
const REST = { first: 6, between: [45, 100] } as const;

const suits = (p: Phrase): Moment => (p.startsWith("night") ? "night" : p.startsWith("ruin") ? "ruin" : "day");

function moment(ear: Earshot): Moment {
  if (failing(ear.decline) > 0.5) return "ruin";
  return ear.night > 0.55 ? "night" : "day";
}

/** Plays `bank` into `out` from `start` by `plan`. `random` picks the phrases and the rests. */
export function createMusic(ctx: BaseAudioContext, bank: MusicBank, out: AudioNode, plan: MusicPlan, start: number, random: () => number): Music {
  if (plan === "phrases") {
    const level = db(HUSH.music - bank.lufs.phrases);
    let next = start + REST.first;
    let chosen: Phrase | null = null;
    return {
      at(t, ear) {
        if (t < next) return;
        if (chosen === null) {
          const fitting = PHRASES.filter((p) => suits(p) === moment(ear));
          chosen = fitting[Math.floor(random() * fitting.length)] ?? null;
          if (chosen === null) return;
        }
        // The phrase plays once decoded, so the first time it starts a moment late.
        const buffer = bank.phrases.take(chosen);
        if (buffer === null) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = level;
        source.connect(gain).connect(out);
        source.start(t);
        const played = chosen;
        source.onended = () => bank.phrases.put(played);
        next = t + buffer.duration + REST.between[0] + random() * (REST.between[1] - REST.between[0]);
        chosen = null;
      },
    };
  }

  // Each part plays its chunk n at `start + n * seconds`, so the parts stay together. A part that joins late starts
  // partway into the chunk the others are playing.
  const base = db(HUSH.music - bank.lufs.piece);
  const { count, seconds, margin } = bank.chunk;
  interface Part {
    readonly gain: GainNode;
    wantedAt: number;
    /** The index of the next chunk to schedule, counted from the start, and the earliest time it may start. Null while the part is stopped. */
    next: number | null;
    from: number;
    readonly playing: Set<AudioBufferSourceNode>;
  }
  const parts = Object.fromEntries(
    STEMS.map((stem) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.connect(out);
      return [stem, { gain, wantedAt: start, next: null, from: start, playing: new Set() } satisfies Part];
    }),
  ) as Record<Stem, Part>;
  /** Schedules each decoded chunk of the part that is due to start within `AHEAD` seconds of `t`. */
  const feed = (t: number, stem: Stem, part: Part): void => {
    while (part.next !== null) {
      const n = part.next;
      const begins = start + n * seconds;
      const at = Math.max(begins, part.from);
      if (at > t + AHEAD) return;
      const name: Chunk = `${stem}:${n % count}`;
      const buffer = bank.chunks.take(name);
      if (buffer === null) {
        // Still decoding. A chunk already under way is joined partway once ready, or skipped near its end.
        if (at <= t && begins + seconds - t < JOIN_BEFORE) {
          part.next = n + 1;
          part.from = begins + seconds;
        } else if (at <= t) part.from = t;
        return;
      }
      const into = at - begins;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(part.gain);
      source.start(at, margin + into, seconds - into);
      source.onended = () => {
        part.playing.delete(source);
        source.disconnect();
        bank.chunks.put(name);
      };
      part.playing.add(source);
      part.next = n + 1;
      part.from = begins + seconds;
    }
  };
  // For `layers`: whether the theme plays on this pass through the piece, decided as each pass begins.
  let round = -1;
  let theme = 1;
  /** Sets a part's level from `t`. A `wanted` part keeps playing, silent at level 0 if need be, so it can come in on time. */
  const set = (t: number, stem: Stem, v: number, wanted: boolean): void => {
    const part = parts[stem];
    if (wanted) {
      part.wantedAt = t;
      if (part.next === null) {
        part.next = Math.max(0, Math.floor((t - start) / seconds));
        part.from = Math.max(t, start);
      }
    } else if (part.next !== null && t - part.wantedAt > RELEASE) {
      for (const source of part.playing) source.stop(t);
      part.next = null;
    }
    feed(t, stem, part);
    part.gain.gain.setTargetAtTime(v * base, t, SWELL);
  };
  return {
    at(t, ear) {
      const night = smooth(0.35, 0.75, ear.night);
      const ruin = plan === "layers" ? failing(ear.decline) : 0;
      if (plan === "layers") {
        const now = Math.floor((t - start) / (count * seconds));
        // The theme plays on the first pass, then on two passes in three.
        if (now !== round) theme = now <= 0 || random() < 0.67 ? 1 : 0;
        round = now;
      }
      // The night colour and the minor bed start playing silently a little before they are audible, so they come in on time.
      set(t, "bed", 1 - ruin, ruin < 1);
      set(t, "minor", ruin * db(MINOR_LIFT), plan === "layers" && failing(ear.decline + 0.04) > 0);
      set(t, "melody", theme * (1 - ruin) * (1 - 0.4 * night), true);
      set(t, "shimmer", night, ear.night > 0.25);
    },
  };
}
