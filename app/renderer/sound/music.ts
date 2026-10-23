// The score in the game: the film's storybook chamber music, played for open
// play rather than to a cut. It can play three ways; the game plays layers:
//   phrases  a short phrase now and then, chosen by the hour and the land,
//            with the world alone between;
//   loop     one piece looping without end, its night colour coming in with
//            the dark;
//   layers   the same piece's parts coming and going: the theme some times
//            round and not others, the night colour with the dark, and the
//            harmony turning minor where the land has failed.
// It schedules on the audio context's clock, so it plays the same live and
// rendered offline from a recorded walk.

import type { Earshot } from "../terrain/world.ts";
import { HUSH, failing } from "./hearing.ts";
import type { Shelf } from "./shelf.ts";

export type MusicPlan = "phrases" | "loop" | "layers";
export const STEMS = ["bed", "melody", "shimmer", "minor"] as const;
export type Stem = (typeof STEMS)[number];
export const PHRASES = ["day-1", "day-2", "day-3", "day-4", "night-1", "night-2", "ruin-1"] as const;
export type Phrase = (typeof PHRASES)[number];
/** When a phrase suits: by day on thriving land, at night, or where the land has failed. */
export type Moment = "day" | "night" | "ruin";

/** The score's recordings, decoded while they may be heard: the piece's parts, all one length so they loop together, and the phrases. */
export interface MusicBank {
  readonly stems: Shelf<Stem>;
  readonly phrases: Shelf<Phrase>;
  /** How long the piece is, seconds, and the loudness of the whole piece (bed and melody together) and of the phrases, LUFS, so both play at the Hush mix's -21. */
  readonly length: number;
  readonly lufs: { readonly piece: number; readonly phrases: number };
}

export interface Music {
  /** Follows what the person hears at moment `t`, seconds on the context's clock. */
  at(t: number, ear: Earshot): void;
}

const db = (v: number): number => 10 ** (v / 20);
const smooth = (e0: number, e1: number, v: number): number => {
  const c = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return c * c * (3 - 2 * c);
};
/** How slowly a part comes and goes, seconds: its time constant. */
const SWELL = 4;
/** The minor bed is written darker and sparser, 2.7 dB under the bed; this much of that is made up, so failing land never sounds like the music dropping out, dB. */
const MINOR_LIFT = 2;
/** A part not wanted this long stops and lets its recording go, seconds. */
const RELEASE = 60;
/** Phrases: how long after the world opens the first one comes, and the rest between one's end and the next, seconds. */
const REST = { first: 6, between: [45, 100] } as const;

const suits = (p: Phrase): Moment => (p.startsWith("night") ? "night" : p.startsWith("ruin") ? "ruin" : "day");

function moment(ear: Earshot): Moment {
  if (failing(ear.decline) > 0.5) return "ruin";
  return ear.night > 0.55 ? "night" : "day";
}

/** Plays `bank` into `out` from `start` by `plan`; `random` picks the phrases and the rests. */
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
        // The phrase plays once it is decoded, a moment later the first time.
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

  // The piece's parts loop together: a part that joins late starts where the others have got to.
  const base = db(HUSH.music - bank.lufs.piece);
  const parts = Object.fromEntries(
    STEMS.map((stem) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.connect(out);
      return [stem, { gain, source: null as AudioBufferSourceNode | null, wantedAt: start }];
    }),
  ) as Record<Stem, { gain: GainNode; source: AudioBufferSourceNode | null; wantedAt: number }>;
  // Layers: whether the theme plays this time round, decided as each time round begins.
  let round = -1;
  let theme = 1;
  /** Sets a part's level from `t`; a part that is `wanted` plays (silently, at level 0) so it can come in on time. */
  const set = (t: number, stem: Stem, v: number, wanted: boolean): void => {
    const part = parts[stem];
    if (wanted) {
      part.wantedAt = t;
      if (part.source === null) {
        const buffer = bank.stems.take(stem);
        if (buffer !== null) {
          part.source = ctx.createBufferSource();
          part.source.buffer = buffer;
          part.source.loop = true;
          part.source.connect(part.gain);
          part.source.start(t, (((t - start) % bank.length) + bank.length) % bank.length);
        }
      }
    } else if (part.source !== null && t - part.wantedAt > RELEASE) {
      part.source.stop(t);
      part.source.disconnect();
      part.source = null;
      bank.stems.put(stem);
    }
    part.gain.gain.setTargetAtTime(v * base, t, SWELL);
  };
  return {
    at(t, ear) {
      const night = smooth(0.35, 0.75, ear.night);
      const ruin = plan === "layers" ? failing(ear.decline) : 0;
      if (plan === "layers") {
        const now = Math.floor((t - start) / bank.length);
        // The theme plays the first time round, then two times in three.
        if (now !== round) theme = now <= 0 || random() < 0.67 ? 1 : 0;
        round = now;
      }
      // The night colour and the minor bed are wanted a little before they are heard, so they come in on time.
      set(t, "bed", 1 - ruin, ruin < 1);
      set(t, "minor", ruin * db(MINOR_LIFT), plan === "layers" && failing(ear.decline + 0.04) > 0);
      set(t, "melody", theme * (1 - ruin) * (1 - 0.4 * night), true);
      set(t, "shimmer", night, ear.night > 0.25);
    },
  };
}
