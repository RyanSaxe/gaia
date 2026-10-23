// The world's sound as Web Audio plays it: each bed looping through its own
// tone, side and level while it can be heard, and the one-shot sounds (a
// footfall, the journal's paper) laid in at their moment. It runs on any
// audio context, so the page plays it live and a recorded walk renders it
// offline on the same graph.

import { BEDS, type Bed, HUSH, type Mix } from "./hearing.ts";
import type { Shelf } from "./shelf.ts";

/** A recording of many short sounds laid end to end, such as footfalls: where each starts and how long it lasts, seconds. */
export interface Sprite {
  readonly buffer: AudioBuffer;
  readonly cuts: readonly { readonly at: number; readonly length: number }[];
}

export type Ground = "grass" | "dry" | "wood";
export type Paper = "open" | "shut" | "turn" | "riffle";

/** Every recording the world plays, the beds decoded while they may be heard, with each one's own loudness, LUFS. */
export interface Bank {
  readonly beds: Shelf<Bed>;
  readonly steps: Readonly<Record<Ground, Sprite>>;
  readonly paper: Readonly<Record<Paper, AudioBuffer>>;
  readonly lufs: Readonly<Record<Bed | `steps-${Ground}` | Paper, number>>;
}

export interface Soundscape {
  /** Eases every bed toward its level, side and tone in `mix` from moment `t`, seconds on the context's clock. */
  at(t: number, mix: Mix): void;
  /** A footfall at `t` on `ground`, on the `side` it falls (-1 left, 1 right). */
  step(t: number, ground: Ground, side: number): void;
  /** The journal's paper at `t`, which `stop` cuts short with a tenth of a second's fade, as a riffle stops with its leaves. */
  paper(t: number, what: Paper): { stop(t: number): void };
  /** Where the world's sounds and the music play: each a level that silences it at 0, as a recording of one alone does. */
  readonly world: GainNode;
  readonly music: GainNode;
}

const db = (v: number): number => 10 ** (v / 20);
/** How quickly a bed follows a change in what is heard: its time constant, seconds. */
const EASE = { gain: 0.35, pan: 0.3, tone: 0.4 } as const;
/** How long the whole world fades in at first, seconds. */
const FADE_IN = 3;
/** A bed quieter than this, against its Hush level (about -50 dB), is not heard: it starts once it rises past it. */
const HEARD = 0.003;
/** A bed unheard this long stops and lets its recording go, seconds. */
const RELEASE = 60;
const PAPER_LEVEL: Readonly<Record<Paper, number>> = { open: -4, shut: -6, turn: -5, riffle: -6 };
/** The page-turn recording holds two turns: only the first plays, seconds. */
const ONE_TURN = 0.9;

/** One of the world's sounds alone: a bed, the footfalls or the journal's paper. */
export type Solo = Bed | "steps" | "paper";

/**
 * Builds the graph on `ctx` into `out`, every bed starting silent at `start`
 * a different way into its loop, and the world fading in from there. `random`
 * picks which footfall plays and where each bed starts. With `solo`, only
 * that sound plays, as a recording of it alone.
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

  // Each bed's tone, side and level stand ready; its recording plays only while it can be heard.
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
            // A different way into the loop each time it starts, rising from silence.
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
      // No two footfalls alike: a little higher or lower, and a decibel or so either way.
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
