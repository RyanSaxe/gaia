// Builds the Web Audio graph for the world's sound. Each bed loops through
// its own low-pass, pan and gain while it is audible, and one-shot sounds such
// as footfalls and the journal's paper are scheduled at their time. It runs on
// any audio context, so the page plays it live and a recorded walk renders it
// offline on the same graph.

import { BEDS, type Bed, HUSH, type Mix } from "./hearing.ts";
import type { Shelf } from "./shelf.ts";

/** A recording of many short sounds end to end, such as footfalls, with each one's start and length in seconds. */
export interface Sprite {
  readonly buffer: AudioBuffer;
  readonly cuts: readonly { readonly at: number; readonly length: number }[];
}

export type Ground = "grass" | "dry" | "wood";
export type Paper = "open" | "shut" | "turn" | "riffle";

/** Every recording the world plays, with the beds decoded while they may be heard, and each recording's loudness in LUFS. */
export interface Bank {
  readonly beds: Shelf<Bed>;
  readonly steps: Readonly<Record<Ground, Sprite>>;
  readonly paper: Readonly<Record<Paper, AudioBuffer>>;
  readonly lufs: Readonly<Record<Bed | `steps-${Ground}` | Paper, number>>;
}

export interface Soundscape {
  /** Eases every bed toward its gain, pan and low-pass in `mix` from time `t`, in seconds on the context's clock. */
  at(t: number, mix: Mix): void;
  /** Plays a footfall at `t` on `ground`, on `side` from -1 left to 1 right. */
  step(t: number, ground: Ground, side: number): void;
  /** Plays a journal paper sound at `t`. `stop` cuts it short with a 0.1 s fade, as a riffle stops when its pages do. */
  paper(t: number, what: Paper): { stop(t: number): void };
  /** The world sound and music buses. A gain of 0 silences one, as when recording the other alone. */
  readonly world: GainNode;
  readonly music: GainNode;
}

const db = (v: number): number => 10 ** (v / 20);
/** Time constants in seconds for a bed to follow a change in gain, pan and low-pass. */
const EASE = { gain: 0.35, pan: 0.3, tone: 0.4 } as const;
/** Seconds for the whole world to fade in at first. */
const FADE_IN = 3;
/** The gain relative to its Hush level, about -50 dB, below which a bed is inaudible. The bed starts once it rises past it. */
const HEARD = 0.003;
/** Seconds after which an inaudible bed stops and releases its recording. */
const RELEASE = 60;
const PAPER_LEVEL: Readonly<Record<Paper, number>> = { open: -4, shut: -6, turn: -5, riffle: -6 };
/** The page-turn recording holds two turns, and only the first, this many seconds long, plays. */
const ONE_TURN = 0.9;

/** A single world sound to play alone: a bed, the footfalls or the journal's paper. */
export type Solo = Bed | "steps" | "paper";

/**
 * Builds the graph on `ctx` into `out`. Every bed starts silent at `start`, at
 * a random point in its loop, and the world fades in from there. `random`
 * picks which footfall plays and where each bed starts. With `solo`, only that
 * sound plays.
 */
export function createSoundscape(ctx: BaseAudioContext, bank: Bank, out: AudioNode, start: number, random: () => number, solo: Solo | null = null): Soundscape {
  const plays = (sound: Solo): boolean => solo === null || solo === sound;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, start);
  master.gain.linearRampToValueAtTime(1, start + FADE_IN);
  master.connect(out);
  const world = ctx.createGain();
  world.connect(master);
  const music = ctx.createGain();
  music.connect(master);

  // Each bed's filter, panner and gain exist from the start, and its recording plays only while it is audible.
  const beds = BEDS.map((name) => {
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.Q.value = 0.5;
    const side = ctx.createStereoPanner();
    const level = ctx.createGain();
    level.gain.setValueAtTime(0, start);
    tone.connect(side).connect(level).connect(world);
    return { name, tone, side, level, base: db(HUSH[name] - bank.lufs[name]), source: null as AudioBufferSourceNode | null, heardAt: 0 };
  });

  let last = -1;
  return {
    at(t, mix) {
      for (const b of beds) {
        const layer = mix[b.name];
        const heard = plays(b.name) && layer.gain > HEARD;
        if (heard && b.source === null) {
          const buffer = bank.beds.take(b.name);
          if (buffer !== null) {
            // Each start begins at a random point in the loop and rises from silence.
            b.source = ctx.createBufferSource();
            b.source.buffer = buffer;
            b.source.loop = true;
            b.source.connect(b.tone);
            b.source.start(t, random() * buffer.duration);
            b.level.gain.setValueAtTime(0, t);
          }
        }
        if (heard) b.heardAt = t;
        if (b.source !== null && t - b.heardAt > RELEASE) {
          b.source.stop(t);
          b.source.disconnect();
          b.source = null;
          bank.beds.put(b.name);
        }
        b.level.gain.setTargetAtTime(heard ? layer.gain * b.base : 0, t, EASE.gain);
        b.side.pan.setTargetAtTime(layer.pan, t, EASE.pan);
        b.tone.frequency.setTargetAtTime(Math.min(layer.lowpass, ctx.sampleRate / 2 - 100), t, EASE.tone);
      }
    },
    step(t, ground, side) {
      if (!plays("steps")) return;
      const sprite = bank.steps[ground];
      let k = Math.floor(random() * sprite.cuts.length);
      if (k === last) k = (k + 1) % sprite.cuts.length;
      last = k;
      const cut = sprite.cuts[k] as Sprite["cuts"][number];
      const source = ctx.createBufferSource();
      source.buffer = sprite.buffer;
      // Each footfall varies slightly in pitch, and by about a decibel either way, so no two sound alike.
      source.detune.value = (random() - 0.5) * 80;
      const pan = ctx.createStereoPanner();
      pan.pan.value = side * 0.08;
      const level = ctx.createGain();
      level.gain.value = db(HUSH.steps - bank.lufs[`steps-${ground}`] + (random() - 0.5) * 3);
      source.connect(pan).connect(level).connect(world);
      source.start(t, cut.at, cut.length);
    },
    paper(t, what) {
      const buffer = bank.paper[what];
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const level = ctx.createGain();
      const gain = db(HUSH.book - bank.lufs[what] + PAPER_LEVEL[what]);
      level.gain.setValueAtTime(gain, t);
      if (plays("paper")) source.connect(level).connect(world);
      if (what === "turn") source.start(t, 0, ONE_TURN);
      else source.start(t);
      return {
        stop(at) {
          if (at >= t + buffer.duration) return;
          level.gain.setValueAtTime(gain, at);
          level.gain.linearRampToValueAtTime(0, at + 0.1);
          source.stop(at + 0.12);
        },
      };
    },
    world,
    music,
  };
}
