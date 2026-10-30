import { describe, expect, it } from "vitest";
import type { Earshot } from "../terrain/world.ts";
import { type Chunk, type MusicBank, type Phrase, createMusic } from "./music.ts";
import type { Shelf } from "./shelf.ts";

interface Started {
  readonly name: string;
  readonly at: number;
  readonly offset: number;
  readonly duration: number;
}

/** A fake buffer source that records what it was asked to play, and from when. */
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

/** A fake audio context that keeps each gain's latest target and when each source played, which is enough to read what the music plays. */
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

describe("the piece, streamed a chunk at a time", () => {
  /** What the bed played over `seconds` of noon, updating the music every tenth of a second. */
  function bedOver(seconds: number, joinAt = 0): Started[] {
    const { ctx, started } = listeningContext();
    const music = createMusic(ctx, BANK, {} as AudioNode, "loop", 0, () => 0);
    for (let t = joinAt; t < seconds; t += 0.1) music.at(t, NOON);
    return started.filter((s) => s.name.startsWith("bed"));
  }

  /** Where in the piece a start plays from, in seconds: its chunk's place in the piece and how far into the chunk it begins. */
  const from = (s: Started): number => Number(s.name.split(":")[1]) * CHUNK.seconds + s.offset - CHUNK.margin;
  const piece = CHUNK.count * CHUNK.seconds;
  /** Each start plays the piece where the music's clock stands, and begins as the one before it ends. */
  function expectSeamless(bed: readonly Started[], joinAt: number): void {
    expect(bed[0]?.at).toBeCloseTo(joinAt, 9);
    for (const [k, s] of bed.entries()) {
      const behind = (((from(s) - s.at) % piece) + piece) % piece;
      expect(Math.min(behind, piece - behind), `start ${k}`).toBeLessThan(1e-6);
      const next = bed[k + 1];
      if (next !== undefined) expect(next.at, `start ${k + 1}`).toBeCloseTo(s.at + s.duration, 9);
    }
  }

  it("plays on without a gap, a skip or a part out of time, round the piece and back to its start, and a part that joins late in time with the rest", () => {
    const bed = bedOver(110);
    expectSeamless(bed, 0);
    expect(bed.some((s, k) => k > 0 && from(s) < from(bed[k - 1] as Started)), "the piece comes round to its start").toBe(true);
    expectSeamless(bedOver(30, 20), 20);
  });
});
