import { describe, expect, it } from "vitest";
import type { Earshot } from "../terrain/world.ts";
import { type Chunk, type MusicBank, type Phrase, type Stem, createMusic } from "./music.ts";
import type { Shelf } from "./shelf.ts";

interface Started {
  readonly name: string;
  readonly at: number;
  readonly offset: number;
  readonly duration: number;
}

/** A buffer source that only notes what it was asked to play, and from when. */
class Source {
  buffer: { readonly name: string; readonly duration: number } | null = null;
  loop = false;
  onended: (() => void) | null = null;
  constructor(private readonly started: Started[]) {}
  connect(n: unknown): unknown {
    return n;
  }
  disconnect(): void {}
  start(at = 0, offset = 0, duration = this.buffer?.duration ?? 0): void {
    this.started.push({ name: this.buffer?.name ?? "?", at, offset, duration });
  }
  stop(): void {}
}

/** An audio context that only keeps each gain's latest target, and what each source played from when: enough to read what the music plays. */
function listeningContext(): { ctx: BaseAudioContext; gains: { target: number }[]; started: Started[] } {
  const gains: { target: number }[] = [];
  const started: Started[] = [];
  const node = { connect: (n: unknown) => n, disconnect: () => undefined };
  const ctx = {
    createGain() {
      const g = { target: 0 };
      gains.push(g);
      return { ...node, gain: { value: 0, setValueAtTime: () => undefined, setTargetAtTime: (v: number) => void (g.target = v) } };
    },
    createBufferSource() {
      return new Source(started);
    },
  } as unknown as BaseAudioContext;
  return { ctx, gains, started };
}

function shelf<K extends string>(): Shelf<K> {
  return { take: (name) => ({ name, duration: 30 }) as unknown as AudioBuffer, put: () => undefined, ready: async () => undefined, held: () => 0 };
}

const CHUNK = { count: 8, seconds: 12.8, margin: 0.1 };
const BANK: MusicBank = { chunks: shelf<Chunk>(), chunk: CHUNK, phrases: shelf<Phrase>(), lufs: { piece: -21, phrases: -21 } };
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
    expect(started.every((s) => s.name.startsWith("day"))).toBe(true);
  });
});

describe("the piece, streamed a chunk at a time", () => {
  /** What the bed played over `seconds` of noon, following the music every tenth of a second. */
  function bedOver(seconds: number, joinAt = 0): Started[] {
    const { ctx, started } = listeningContext();
    const music = createMusic(ctx, BANK, {} as AudioNode, "loop", 0, () => 0);
    for (let t = joinAt; t < seconds; t += 0.1) music.at(t, NOON);
    return started.filter((s) => s.name.startsWith("bed"));
  }

  it("plays each chunk's own music, one straight after another, round the piece and back to its start", () => {
    const bed = bedOver(110);
    expect(bed.slice(0, 9).map((s) => s.name)).toEqual(["bed:0", "bed:1", "bed:2", "bed:3", "bed:4", "bed:5", "bed:6", "bed:7", "bed:0"]);
    for (const [k, s] of bed.entries()) {
      expect(s.offset).toBeCloseTo(CHUNK.margin, 9);
      expect(s.at).toBeCloseTo(k * CHUNK.seconds, 9);
      expect(s.duration).toBeCloseTo(CHUNK.seconds, 9);
    }
  });

  it("asks for a chunk only a few seconds before it plays", () => {
    // At 20 s the bed is in its second chunk; only the third is due within the next few seconds.
    expect(bedOver(20).map((s) => s.name)).toEqual(["bed:0", "bed:1"]);
    expect(bedOver(23).map((s) => s.name)).toEqual(["bed:0", "bed:1", "bed:2"]);
  });

  it("joins late partway into the chunk the other parts are playing", () => {
    const [first, second] = bedOver(30, 20);
    expect(first?.name).toBe("bed:1");
    expect(first?.at).toBeCloseTo(20, 9);
    expect(first?.offset).toBeCloseTo(CHUNK.margin + 20 - CHUNK.seconds, 9);
    expect(second?.at).toBeCloseTo(2 * CHUNK.seconds, 9);
  });
});
