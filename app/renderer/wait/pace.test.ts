import { describe, expect, it } from "vitest";
import { FLUSH_MS, pacer } from "./pace.ts";

/** Every item's time, drawing `p` frame by frame from `from` until it is empty or `until`. */
function drawn<T>(p: ReturnType<typeof pacer<T>>, from: number, until: number): [number, T][] {
  const out: [number, T][] = [];
  for (let t = from; t <= until && p.size > 0; t += 16) for (const item of p.due(t)) out.push([t, item]);
  return out;
}

describe("the wait's pace", () => {
  it("draws a burst one stroke after another at its own pace when nothing presses", () => {
    const p = pacer<number>({ everyMs: 200, spreadMs: [2000, 12000] });
    p.add([1, 2, 3, 4], 0);
    const times = drawn(p, 0, 5000).map(([t]) => t);
    expect(times).toHaveLength(4);
    for (const [a, b] of times.slice(1).map((t, i) => [times[i] as number, t])) expect((b as number) - (a as number)).toBeGreaterThanOrEqual(192);
  });

  it("draws a big burst faster, so it lasts a little past when the next one is due", () => {
    const p = pacer<number>({ everyMs: 500, spreadMs: [1000, 20000] });
    p.add([0], 0);
    p.due(0);
    // Bursts have come 6 s apart: 120 strokes are spread over a little more than that, not 60 s at the calm pace, and
    // not just 6 s, which an uneven next burst would often leave still.
    p.add(Array.from({ length: 120 }, (_, i) => i), 6000);
    const times = drawn(p, 6000, 80000).map(([t]) => t);
    expect(times).toHaveLength(120);
    expect((times.at(-1) as number) - 6000).toBeGreaterThan(6000);
    expect((times.at(-1) as number) - 6000).toBeLessThan(12000);
  });

  it("never draws anything before it has happened", () => {
    const p = pacer<string>({ everyMs: 100, spreadMs: [1000, 5000] });
    expect(p.due(1000)).toEqual([]);
    p.add(["a"], 2000);
    expect(p.due(1999)).toEqual([]);
    expect(p.due(2000)).toEqual(["a"]);
  });

  it("once flushed, draws what is left within the flush", () => {
    const p = pacer<number>({ everyMs: 1000, spreadMs: [10000, 20000] });
    p.add(Array.from({ length: 50 }, (_, i) => i), 0);
    p.due(0);
    p.flush(100);
    const times = drawn(p, 100, 60000).map(([t]) => t);
    expect(times).toHaveLength(49);
    expect((times.at(-1) as number) - 100).toBeLessThanOrEqual(FLUSH_MS + 32);
  });
});
