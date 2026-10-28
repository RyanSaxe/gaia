import { describe, expect, it } from "vitest";
import { SWIPE, swipes } from "./swipe.ts";

/** The turns a gesture produces, with `deltas` as [dx, dy] and one event every 16 ms from `start`. */
const gesture = (read: ReturnType<typeof swipes>, deltas: readonly (readonly [number, number])[], start: number): (1 | -1)[] =>
  deltas.flatMap(([dx, dy], k) => {
    const by = read(dx, dy, start + k * 16);
    return by === null ? [] : [by];
  });

describe("a swipe or the wheel over the journal", () => {
  it("turns one page a gesture, its momentum included, and again once the gesture has rested", () => {
    const read = swipes();
    // A swipe to the left, then two seconds of decaying momentum, turns forward once.
    const swipe = [...Array.from({ length: 10 }, () => [30, 2] as const), ...Array.from({ length: 120 }, (_, k) => [Math.max(1, 20 - k / 6), 0] as const)];
    expect(gesture(read, swipe, 0)).toEqual([1]);
    // A wheel scrolled up after a rest turns back once.
    const end = 130 * 16;
    expect(gesture(read, [[0, -60], [0, -60], [0, -60]], end + SWIPE.rest + 1)).toEqual([-1]);
  });

  it("never turns for a nudge too small to mean one", () => {
    const read = swipes();
    expect(gesture(read, [[4, 0], [6, 0], [-3, 0], [8, 1]], 0)).toEqual([]);
    // Small deltas do not add up across rests either.
    expect(gesture(read, [[30, 0]], SWIPE.rest + 100)).toEqual([]);
  });
});
