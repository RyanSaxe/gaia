// The world's sound on the page: what the person hears where they stand
// (`hearing.ts`), played on one graph (`soundscape.ts`) from each frame
// (`listener.ts`), under the score (`music.ts`), each at the level the
// person set on the slip (`levels.ts`). With `?sound=record` the page plays nothing aloud and
// keeps a log of what the person hears instead, which `render` plays through
// the same graph offline: a recording of a walk made in a hidden window.

import type { WorldHandle } from "../terrain/world.ts";
import { type Solo, createSoundscape } from "./soundscape.ts";
import { type BookState, type Moment, createListener } from "./listener.ts";
import { loadBank, loadMusic } from "./bank.ts";
import { type MusicPlan, PHRASES, STEMS, createMusic } from "./music.ts";
import { BEDS } from "./hearing.ts";
import { gainOf, soundLevels } from "./levels.ts";

/** How the music plays: its parts coming and going with the hour and the land. */
const PLAN: MusicPlan = "layers";
/** How quickly a slider's change is heard: its time constant, seconds, quick but never a click. */
const LEVEL_EASE = 0.05;

/** How a walk renders: with which way of playing the music (none without), and with the world's sounds, none, or one alone. */
export interface Rendering {
  readonly music?: MusicPlan | null;
  readonly world?: boolean;
  readonly solo?: Solo;
}

export interface Sound {
  /** Hears the world as it stands this frame. */
  frame(): void;
  readonly hook: Readonly<Record<string, unknown>>;
}

/** A small seeded random, so a rendered walk plays the same footfalls every time. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Renders a walk's moments offline, stereo at `rate`, as the page would have played them. */
async function renderWalk(moments: readonly Moment[], how: Rendering, rate = 48000): Promise<AudioBuffer> {
  const first = moments[0];
  const last = moments.at(-1);
  if (first === undefined || last === undefined) throw new Error("Nothing was recorded: call record(true) and walk first.");
  const seconds = last.t - first.t + 0.5;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * rate), sampleRate: rate });
  const random = seeded(17);
  // Rendered in one pass, the walk needs every recording decoded before it starts.
  const bank = await loadBank(ctx, true);
  await bank.beds.ready(BEDS);
  const scape = createSoundscape(ctx, bank, ctx.destination, 0, random, how.solo ?? null);
  if (how.world === false) scape.world.gain.value = 0;
  let music = null;
  if (how.music !== undefined && how.music !== null) {
    const score = loadMusic(ctx, true);
    await Promise.all([score.stems.ready(STEMS), score.phrases.ready(PHRASES)]);
    music = createMusic(ctx, score, scape.music, how.music, 0, seeded(29));
  }
  const listener = createListener(scape, music);
  for (const m of moments) listener.hear({ ...m, t: m.t - first.t });
  return ctx.startRendering();
}

/** A rendered clip as 16-bit stereo WAV, base64, small enough to hand to a script. */
function wavBase64(b: AudioBuffer): string {
  const n = b.length;
  const view = new DataView(new ArrayBuffer(44 + n * 4));
  const text = (at: number, s: string): void => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + n * 4, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, b.sampleRate, true);
  view.setUint32(28, b.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, n * 4, true);
  const l = b.getChannelData(0);
  const r = b.getChannelData(1);
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i] as number)) * 32767, true);
    view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i] as number)) * 32767, true);
  }
  const bytes = new Uint8Array(view.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createSound(world: WorldHandle, book: () => BookState): Sound {
  const recording = new URLSearchParams(location.search).get("sound") === "record";
  const moments: Moment[] = [];
  let keeping = false;

  if (recording) {
    return {
      frame() {
        if (keeping) moments.push({ t: performance.now() / 1000, ear: world.earshot(), book: book() });
      },
      hook: {
        /** Starts keeping what the person hears each frame, from nothing, or stops. */
        record: (on: boolean) => {
          if (on) moments.length = 0;
          keeping = on;
          return moments.length;
        },
        /** What was heard so far: how many frames, over how many seconds. */
        kept: () => ({ frames: moments.length, seconds: moments.length < 2 ? 0 : (moments.at(-1) as Moment).t - (moments[0] as Moment).t }),
        /** The walk kept so far, rendered as the page would have played it, as base64 WAV. */
        render: async (how: Rendering = {}) => wavBase64(await renderWalk(moments, how)),
        /** The log itself, for checking what was heard. */
        moments: () => moments,
        /** Takes back a log `moments` returned, so a walk renders again without walking it. */
        replay: (kept: readonly Moment[]) => {
          keeping = false;
          moments.splice(0, moments.length, ...kept);
          return moments.length;
        },
      },
    };
  }

  const ctx = new AudioContext({ latencyHint: "playback" });
  // Everything passes a meter on its way out, so a muted window can still tell that sound plays and how loud.
  const meter = ctx.createAnalyser();
  meter.fftSize = 4096;
  meter.connect(ctx.destination);
  let listener: ReturnType<typeof createListener> | null = null;
  const score = loadMusic(ctx);
  // The parts that always play are decoded while the world bakes; the rest as they are wanted.
  const loaded = Promise.all([loadBank(ctx), score.stems.ready(["bed", "melody"])]);
  // The world is heard once it stands and the wait has lifted, fading in from there.
  world.onLifted(() => {
    void loaded.then(([bank]) => {
      const start = ctx.currentTime + 0.1;
      const scape = createSoundscape(ctx, bank, meter, start, Math.random);
      soundLevels().watch((l) => {
        scape.music.gain.setTargetAtTime(gainOf(l.music), ctx.currentTime, LEVEL_EASE);
        scape.world.gain.setTargetAtTime(gainOf(l.world), ctx.currentTime, LEVEL_EASE);
      });
      listener = createListener(scape, createMusic(ctx, score, scape.music, PLAN, start, Math.random));
    });
  });
  // A page may only start sound once the person has touched it; and a page no one can see makes none.
  const wake = (): void => {
    if (!document.hidden && ctx.state === "suspended") void ctx.resume();
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  document.addEventListener("visibilitychange", () => (document.hidden ? void ctx.suspend() : wake()));
  const samples = new Float32Array(meter.fftSize);
  return {
    frame() {
      if (listener !== null && ctx.state === "running") listener.hear({ t: ctx.currentTime, ear: world.earshot(), book: book() });
    },
    hook: {
      /** Whether the page's sound runs: running, suspended until a touch, or closed. */
      state: () => ctx.state,
      /** What the person hears where they stand now. */
      earshot: () => world.earshot(),
      /** How loud the sound leaving the page is now, dBFS over the last tenth of a second; -Infinity in silence. */
      level: () => {
        meter.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        return 10 * Math.log10(sum / samples.length);
      },
    },
  };
}
