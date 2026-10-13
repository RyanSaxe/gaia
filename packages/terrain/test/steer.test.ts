import { describe, expect, it } from "vitest";
import { STEER, type WalkKey, steerPress, steerRelease, steerStep, steering } from "@gaia/terrain";

const DT = 1 / 120;
const deg = (r: number): number => (r * 180) / Math.PI;
const RATE = deg(STEER.rate);
const NUDGE = deg(STEER.nudge);

/** A press: a key down at `at`, let go after `hold` seconds or kept down. */
interface Press {
  readonly key: WalkKey;
  readonly at: number;
  readonly hold?: number;
}

/** Plays presses on a person facing 0, frame by frame, until `until`: each frame's facing (degrees), walk and hurry. */
function play(presses: readonly Press[], until: number) {
  let s = steering();
  let yaw = 0;
  const frames: { t: number; yaw: number; ahead: number; hurry: boolean }[] = [];
  for (let t = 0; t < until; t += DT) {
    for (const p of presses) {
      if (p.at >= t && p.at < t + DT) s = steerPress(s, p.key, p.at);
      const off = p.hold === undefined ? undefined : p.at + p.hold;
      if (off !== undefined && off >= t && off < t + DT) s = steerRelease(s, p.key);
    }
    const step = steerStep(s, t, yaw, DT);
    s = step.steering;
    yaw = step.yaw;
    frames.push({ t, yaw: deg(yaw), ahead: step.ahead, hurry: step.hurry });
  }
  return { yaw: deg(yaw), frames, last: frames[frames.length - 1]! };
}
const at = <F extends { t: number }>(frames: readonly F[], t: number): F => frames.find((f) => f.t >= t) ?? frames[frames.length - 1]!;
/** Every change of facing from frame to frame, degrees. */
const turns = (frames: readonly { yaw: number }[]) => frames.slice(1).map((f, i) => f.yaw - frames[i]!.yaw).filter((d) => Math.abs(d) > 1e-9);

describe("walking comfortably", () => {
  const gestures: Press[] = [
    { key: "ahead", at: 0, hold: 1 },
    { key: "left", at: 0.5, hold: 1.2 },
    { key: "shift", at: 2, hold: 1 },
    { key: "right", at: 2.2, hold: 0.6 },
    { key: "back", at: 3.2, hold: 0.5 },
    { key: "left", at: 4, hold: 0.1 },
    { key: "left", at: 4.2, hold: 0.1 },
  ];

  it("never turns the view faster than the one steady rate, and never in a jump", () => {
    for (const d of turns(play(gestures, 5).frames)) expect(Math.abs(d)).toBeLessThanOrEqual(RATE * DT + 1e-9);
  });

  it("walks at most at the pace, and stops when every key is let go, without turning", () => {
    const { frames, last } = play(gestures, 6);
    for (const f of frames) expect(Math.abs(f.ahead)).toBeLessThanOrEqual(1);
    expect(last.ahead).toBe(0);
    expect(at(frames, 5.5).yaw).toBe(last.yaw);
  });

  it("turns at the steady rate however a press falls between frames", () => {
    // As the page steps: a key pressed between frames is seen at the next frame, which steps on from then.
    const step = 1 / 60;
    for (const pressed of [0.101, 0.105, 0.112]) {
      let s = steering();
      let yaw = 0;
      let fastest = 0;
      for (let t = 0; t < 1.5; t += step) {
        if (t >= pressed && !s.down.has("left")) s = steerPress(s, "left", pressed);
        const next = steerStep(s, t, yaw, step);
        fastest = Math.max(fastest, Math.abs(next.yaw - yaw) / step);
        s = next.steering;
        yaw = next.yaw;
      }
      expect(deg(fastest)).toBeLessThanOrEqual(RATE + 1e-6);
    }
  });
});

describe("the keys", () => {
  it("↑ walks ahead, never turning the view", () => {
    const { frames, yaw } = play([{ key: "ahead", at: 0, hold: 1 }], 1.5);
    expect(at(frames, 0.5).ahead).toBe(1);
    expect(yaw).toBe(0);
  });

  it("a tap of ← or → nudges the view a few degrees at the steady rate, standing or walking", () => {
    expect(play([{ key: "left", at: 0, hold: 0.1 }], 1).yaw).toBeCloseTo(NUDGE, 6);
    const walking = play([{ key: "ahead", at: 0, hold: 2 }, { key: "right", at: 1, hold: 0.1 }], 2);
    expect(walking.yaw).toBeCloseTo(-NUDGE, 6);
    expect(at(walking.frames, 1.5).ahead).toBe(1);
  });

  it("holding ← turns on at the steady rate, standing without walking, and curving a walk", () => {
    const standing = play([{ key: "left", at: 0, hold: 1.5 }], 2);
    expect(standing.yaw).toBeCloseTo(RATE * 1.5, 0);
    expect(standing.frames.every((f) => f.ahead === 0)).toBe(true);
    const walking = play([{ key: "ahead", at: 0, hold: 2 }, { key: "left", at: 0.5, hold: 1 }], 2.5);
    expect(at(walking.frames, 1).ahead).toBe(1);
    expect(walking.yaw).toBeCloseTo(RATE, 0);
  });

  it("↓ walks back at its share of the pace, still facing ahead, and turns only with ← or →", () => {
    const back = play([{ key: "back", at: 0, hold: 2 }], 2.5);
    expect(at(back.frames, 1).ahead).toBeCloseTo(-STEER.back, 6);
    expect(back.frames.every((f) => f.yaw === 0)).toBe(true);
    expect(back.last.ahead).toBe(0);
    const turning = play([{ key: "back", at: 0, hold: 2 }, { key: "left", at: 0.5, hold: 1 }], 2.5);
    expect(at(turning.frames, 1).ahead).toBeCloseTo(-STEER.back, 6);
    expect(turning.yaw).toBeCloseTo(RATE, 0);
  });

  it("↑ and ↓ together stand", () => {
    expect(at(play([{ key: "ahead", at: 0 }, { key: "back", at: 0 }], 0.5).frames, 0.3).ahead).toBe(0);
  });

  it("Shift hurries the walk ahead, never the walk back", () => {
    expect(at(play([{ key: "shift", at: 0 }, { key: "ahead", at: 0.1 }], 1).frames, 0.5).hurry).toBe(true);
    expect(at(play([{ key: "shift", at: 0 }, { key: "back", at: 0.1 }], 1).frames, 0.5).hurry).toBe(false);
  });
});
