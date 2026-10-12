import { describe, expect, it } from "vitest";
import { FULL, type Governor, askedDetail, createGovernor } from "./adapt.ts";

/** A 75 Hz screen's refresh, ms. */
const REFRESH = 1000 / 75;

/** Feeds `governor` frames `interval` ms apart for `ms`, from `from`; returns when they end. */
function frames(governor: Governor, from: number, ms: number, interval: number | ((k: number) => number)): number {
  let now = from;
  for (let k = 0; now < from + ms; k++) {
    const gap = typeof interval === "number" ? interval : interval(k);
    now += gap;
    governor.update(gap, now);
  }
  return now;
}

describe("detail that steps down only while frames come late", () => {
  it("keeps full detail while frames keep the screen's pace", () => {
    const g = createGovernor();
    frames(g, 0, 60_000, REFRESH);
    expect(g.detail).toEqual(FULL);
  });

  it("keeps full detail through stalls that less detail would not cure", () => {
    const g = createGovernor();
    // One frame in ten held up by other work for 80 ms, six refreshes.
    frames(g, 0, 30_000, (k) => (k % 10 === 9 ? 80 : REFRESH));
    expect(g.detail).toEqual(FULL);
  });

  it("steps down least visible first while frames come late, never past half the pixels", () => {
    const g = createGovernor();
    let now = frames(g, 0, 400, REFRESH);
    // Every frame now takes two refreshes; note each detail it passes through.
    const seen: string[] = [];
    for (let t = 0; t < 60_000; t += 100) {
      now = frames(g, now, 100, REFRESH * 2);
      const d = JSON.stringify(g.detail);
      if (seen[seen.length - 1] !== d) seen.push(d);
    }
    const steps = seen.map((d) => JSON.parse(d) as { cards: boolean; alternate: boolean; scale: number });
    expect(steps[0]).toEqual({ cards: true, alternate: false, scale: 1 });
    expect(steps[1]).toEqual({ cards: true, alternate: true, scale: 1 });
    // Then fewer pixels, a little at a time, down to half.
    const scales = steps.slice(2).map((d) => d.scale);
    expect(scales.every((s, i) => s < (i === 0 ? 1 : (scales[i - 1] as number)) && s >= 0.5)).toBe(true);
    expect(scales.every((s, i) => (i === 0 ? 1 : (scales[i - 1] as number)) - s <= 0.05)).toBe(true);
    expect(g.detail).toEqual({ cards: true, alternate: true, scale: 0.5 });
  });

  it("steps back up to full once frames keep the pace again, a step at a time", () => {
    const g = createGovernor();
    let now = frames(g, 0, 30_000, REFRESH * 2);
    expect(g.detail.scale).toBe(0.5);
    // Within the calm after its last step down, it holds.
    now = frames(g, now, 5_000, REFRESH);
    expect(g.detail.scale).toBe(0.5);
    now = frames(g, now, 6_000, REFRESH);
    expect(g.detail.scale).toBeGreaterThan(0.5);
    expect(g.detail.scale).toBeLessThan(1);
    frames(g, now, 120_000, REFRESH);
    expect(g.detail).toEqual(FULL);
  });

  it("settles where frames keep the pace, and retries a step that failed ever more rarely", () => {
    // A device that keeps the pace only below 0.9 of the pixels a side.
    const g = createGovernor();
    let now = 0;
    const tries: number[] = [];
    let last = g.detail.scale;
    while (now < 240_000) {
      const gap = g.detail.scale > 0.9 ? REFRESH * 2 : REFRESH;
      now += gap;
      g.update(gap, now);
      if (g.detail.scale > 0.9 && last <= 0.9) tries.push(now);
      last = g.detail.scale;
    }
    // It never falls past the first step that keeps the pace.
    expect(g.detail.scale).toBe(0.88);
    // Each try at 0.92 waits longer than the one before, up to the longest wait.
    const waits = tries.slice(1).map((t, i) => t - (tries[i] as number));
    expect(waits.length).toBeGreaterThan(3);
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual((waits[i - 1] as number) - REFRESH * 2);
    expect(waits[waits.length - 1]).toBeGreaterThan((waits[0] as number) * 3);
  });

  it("ignores frames while resting, and frames again once woken", () => {
    const g = createGovernor();
    g.rest(Infinity);
    const now = frames(g, 0, 10_000, REFRESH * 2);
    expect(g.detail).toEqual(FULL);
    g.wake(now);
    frames(g, now, 2_000, REFRESH * 2);
    expect(g.detail.cards).toBe(true);
  });

  it("holds the detail a page asks for, whatever the frames do", () => {
    const g = createGovernor();
    g.hold(FULL);
    frames(g, 0, 10_000, REFRESH * 2);
    expect(g.detail).toEqual(FULL);
    g.hold(null);
    expect(g.detail.cards).toBe(true);
  });
});

describe("the detail a page asks for", () => {
  it("reads ?detail=full, least or a share of the pixels, and nothing else", () => {
    expect(askedDetail("")).toBeNull();
    expect(askedDetail("?detail=full")).toEqual(FULL);
    expect(askedDetail("?detail=least")).toEqual({ cards: true, alternate: true, scale: 0.5 });
    expect(askedDetail("?detail=0.75")).toEqual({ cards: true, alternate: true, scale: 0.75 });
    expect(askedDetail("?detail=2")).toBeNull();
    expect(askedDetail("?detail=soft")).toBeNull();
  });
});
