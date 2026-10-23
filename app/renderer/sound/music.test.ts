import { describe, expect, it } from "vitest";
import type { Earshot } from "../terrain/world.ts";
import { type MusicBank, type Phrase, type Stem, createMusic } from "./music.ts";
import type { Shelf } from "./shelf.ts";

/** An audio context that only keeps each gain's latest target, and which sources started: enough to read what the music plays. */
function listeningContext(): { ctx: BaseAudioContext; gains: { target: number }[]; started: string[] } {
  const gains: { target: number }[] = [];
  const started: string[] = [];
  const node = { connect: (n: unknown) => n, disconnect: () => undefined };
  const ctx = {
    createGain() {
      const g = { target: 0 };
      gains.push(g);
      return { ...node, gain: { value: 0, setValueAtTime: () => undefined, setTargetAtTime: (v: number) => void (g.target = v) } };
    },
    createBufferSource() {
      const source = { ...node, buffer: null as { name: string } | null, loop: false, onended: null, start: () => void started.push(source.buffer?.name ?? "?"), stop: () => undefined };
      return source;
    },
  } as unknown as BaseAudioContext;
  return { ctx, gains, started };
}

function shelf<K extends string>(): Shelf<K> {
  return { take: (name) => ({ name, duration: 30 }) as unknown as AudioBuffer, put: () => undefined, ready: async () => undefined };
}

const BANK: MusicBank = { stems: shelf<Stem>(), phrases: shelf<Phrase>(), length: 102.4, lufs: { piece: -21, phrases: -21 } };
const NOON: Earshot = { speed: 0, travelling: false, underfoot: "ground", depth: 0, night: 0, gust: 0.3, decline: 0, canopy: 0, stream: null, mill: null };

/** Each part's level after the music has followed `ear` for a while, in the order bed, melody, shimmer, minor. */
function layersAt(ear: Earshot): Record<Stem, number> {
  const { ctx, gains } = listeningContext();
  const music = createMusic(ctx, BANK, {} as AudioNode, "layers", 0, () => 0);
  music.at(1, ear);
  const [bed, melody, shimmer, minor] = gains.map((g) => g.target) as [number, number, number, number];
  return { bed, melody, shimmer, minor };
}

describe("the music in layers", () => {
  it("never stops, by day or night, on thriving or failing land", () => {
    for (const night of [0, 0.5, 1])
      for (const decline of [0, 0.2, 0.5, 1]) {
        const parts = layersAt({ ...NOON, night, decline });
        expect(parts.bed + parts.minor).toBeGreaterThan(0.5);
      }
  });

  it("turns minor over failing land, and the theme leaves it", () => {
    const failed = layersAt({ ...NOON, decline: 0.5 });
    expect(failed.bed).toBe(0);
    expect(failed.minor).toBeGreaterThan(0.5);
    expect(failed.melody).toBe(0);
  });

  it("brings the night colour in with the dark, and plays the theme softer", () => {
    const noon = layersAt(NOON);
    const night = layersAt({ ...NOON, night: 1 });
    expect(noon.shimmer).toBe(0);
    expect(night.shimmer).toBeGreaterThan(0.5);
    expect(night.melody).toBeLessThan(noon.melody);
  });
});

describe("the music in phrases", () => {
  it("rests between phrases with the world alone", () => {
    const { ctx, started } = listeningContext();
    const music = createMusic(ctx, BANK, {} as AudioNode, "phrases", 0, () => 0);
    for (let t = 0; t < 200; t += 0.5) music.at(t, NOON);
    // A phrase at 6 s, 30 s long, then 45 s alone: the next at 81 s, the one after at 156 s.
    expect(started).toHaveLength(3);
    expect(started.every((name) => name.startsWith("day"))).toBe(true);
  });
});
