import { describe, expect, it } from "vitest";
import { SCHEMES, type SteerScheme, type SteerSchemeId, type WalkKey, steerPress, steerRelease, steerStep, steering } from "@gaia/terrain";

const DT = 1 / 120;
const deg = (r: number): number => (r * 180) / Math.PI;

/** A press: a key down at `at`, let go after `hold` seconds or kept down. */
interface Press {
  readonly key: WalkKey;
  readonly at: number;
  readonly hold?: number;
}

/** Plays presses on a person facing 0, frame by frame, until `until`: each frame's facing (degrees), walk, hurry and blink. */
function play(scheme: SteerScheme, presses: readonly Press[], until: number) {
  let s = steering(scheme);
  let yaw = 0;
  const frames: { t: number; yaw: number; ahead: number; left: number; hurry: boolean; dim: number }[] = [];
  for (let t = 0; t < until; t += DT) {
    for (const p of presses) {
      if (p.at >= t && p.at < t + DT) s = steerPress(s, p.key, p.at, yaw);
      const off = p.hold === undefined ? undefined : p.at + p.hold;
      if (off !== undefined && off >= t && off < t + DT) s = steerRelease(s, p.key, off);
    }
    const step = steerStep(s, t, yaw, DT);
    s = step.steering;
    yaw = step.yaw;
    frames.push({ t, yaw: deg(yaw), ahead: step.ahead, left: step.left, hurry: step.hurry, dim: step.dim });
  }
  return { yaw: deg(yaw), frames, last: frames[frames.length - 1]! };
}
const at = <F extends { t: number }>(frames: readonly F[], t: number): F => frames.find((f) => f.t >= t) ?? frames[frames.length - 1]!;
/** A turn this big from one frame to the next is made at once, a cut, not a rotation anyone watches, degrees. */
const CUT = 20;
/** The fastest the view turned between frames while no blink dimmed it, degrees a second, leaving out turns made at once. */
const onScreenRate = (frames: readonly { yaw: number; dim: number }[]): number =>
  Math.max(...frames.slice(1).map((f, i) => {
    const step = Math.abs(f.yaw - (frames[i]?.yaw ?? 0));
    return f.dim > 0 || (frames[i]?.dim ?? 0) > 0 || step >= CUT ? 0 : step / DT;
  }));
const ids = Object.keys(SCHEMES) as SteerSchemeId[];

describe.each(ids)("walking comfortably (%s)", (id) => {
  const scheme = SCHEMES[id];
  const gestures: Press[] = [
    { key: "ahead", at: 0, hold: 1 },
    { key: "left", at: 0.5, hold: 1.2 },
    { key: "shift", at: 2, hold: 1 },
    { key: "right", at: 2.2, hold: 0.6 },
    { key: "back", at: 3.2, hold: 0.5 },
    { key: "left", at: 4, hold: 0.1 },
    { key: "left", at: 4.2, hold: 0.1 },
  ];

  it("never turns the view on screen faster than the one steady rate, and never speeds a turn up", () => {
    const { frames } = play(scheme, gestures, 5);
    expect(onScreenRate(frames)).toBeLessThanOrEqual(scheme.rate + 1e-6);
  });

  it("walks at most at the pace, never faster on a diagonal, and stops when every key is let go, without turning", () => {
    const { frames, last } = play(scheme, gestures, 6);
    for (const f of frames) expect(Math.hypot(f.ahead, f.left)).toBeLessThanOrEqual(1 + 1e-9);
    expect(last.ahead).toBe(0);
    expect(last.left).toBe(0);
    expect(at(frames, 5.5).yaw).toBe(last.yaw);
  });
});

describe("face and go", () => {
  const go = SCHEMES["face-and-go"];
  const cut = { ...go, blink: 0 };
  /** Every change of facing from frame to frame: a cut is one frame's jump, with nothing turning before or after it. */
  const turns = (frames: readonly { yaw: number }[]) => frames.slice(1).map((f, i) => f.yaw - frames[i]!.yaw).filter((d) => Math.abs(d) > 1e-9);

  it.each([["left", 90], ["right", -90], ["back", 180], ["ahead", 0]] as const)("from still, %s faces that way at once, a cut and never a rotation", (key, to) => {
    const { frames, yaw } = play(cut, [{ key, at: 0.2, hold: 0.1 }], 1);
    expect(yaw).toBeCloseTo(to, 6);
    if (to !== 0) expect(turns(frames)).toEqual([expect.closeTo(to, 6)]);
  });

  it("held, the person walks on forward the new way, looking ahead; a tap only turns", () => {
    const held = play(go, [{ key: "left", at: 0, hold: 1 }], 1.5);
    expect(held.yaw).toBeCloseTo(90, 6);
    expect(at(held.frames, 0.5).ahead).toBe(1);
    expect(held.last.ahead).toBe(0);
    const tap = play(go, [{ key: "left", at: 0, hold: 0.04 }], 0.5);
    expect(tap.yaw).toBeCloseTo(90, 6);
    expect(tap.frames.every((f) => f.ahead === 0)).toBe(true);
  });

  it("still again, ← turns another quarter, and ↑ is what goes on ahead", () => {
    const again = play(cut, [{ key: "left", at: 0, hold: 0.1 }, { key: "left", at: 0.5, hold: 0.1 }], 1);
    expect(again.yaw).toBeCloseTo(180, 6);
    const ahead = play(cut, [{ key: "left", at: 0, hold: 0.5 }, { key: "ahead", at: 1, hold: 0.5 }], 2);
    expect(ahead.yaw).toBeCloseTo(90, 6);
    expect(at(ahead.frames, 1.3).ahead).toBe(1);
  });

  it("walking, a tap of a side key nudges the way a few degrees at the steady rate, never in one jump", () => {
    const { frames, yaw } = play({ ...go, keep: 0 }, [{ key: "ahead", at: 0, hold: 2 }, { key: "right", at: 1, hold: 0.1 }], 2);
    expect(yaw).toBeCloseTo(-go.nudge, 6);
    for (const d of turns(frames)) expect(Math.abs(d)).toBeLessThanOrEqual(go.rate * DT + 1e-9);
    expect(at(frames, 1.5).ahead).toBe(1);
  });

  it("walking, a side key held keeps turning slowly after its nudge, and not at all with keep at 0", () => {
    const kept = play(go, [{ key: "ahead", at: 0, hold: 3 }, { key: "left", at: 1, hold: 1.5 }], 3);
    expect(kept.yaw).toBeCloseTo(go.nudge + go.keep * (1.5 - go.nudge / go.rate), 0);
    const not = play({ ...go, keep: 0 }, [{ key: "ahead", at: 0, hold: 3 }, { key: "left", at: 1, hold: 1.5 }], 3);
    expect(not.yaw).toBeCloseTo(go.nudge, 6);
  });

  it("↑ with ← from still faces the diagonal, or a quarter without it", () => {
    expect(play(go, [{ key: "ahead", at: 0, hold: 0.5 }, { key: "left", at: 0.02, hold: 0.5 }], 1).yaw).toBeCloseTo(45, 6);
    expect(play({ ...go, diagonal: false }, [{ key: "ahead", at: 0, hold: 0.5 }, { key: "left", at: 0.02, hold: 0.5 }], 1).yaw).toBeCloseTo(90, 6);
  });

  it("with a blink, the turn is made at its darkest; with none, nothing dims", () => {
    const { frames } = play(go, [{ key: "back", at: 0, hold: 0.1 }], 0.5);
    const jump = frames.findIndex((f, i) => i > 0 && Math.abs(f.yaw - frames[i - 1]!.yaw) > 10);
    // Within a frame of the darkest.
    expect(frames[jump]!.dim).toBeGreaterThan(0.9);
    expect(frames.filter((f) => f.dim > 0).length * DT).toBeCloseTo(go.blink, 1);
    expect(play(cut, [{ key: "back", at: 0, hold: 0.1 }], 0.5).frames.every((f) => f.dim === 0)).toBe(true);
  });

  it("Shift hurries the walk", () => {
    const { frames } = play(go, [{ key: "shift", at: 0 }, { key: "ahead", at: 0.1 }], 1);
    expect(at(frames, 0.5).hurry).toBe(true);
  });
});

describe("walk and look (shooter, mouse-look)", () => {
  it.each(["shooter", "mouse-look"] as const)("%s: the keys walk relative to the view and never turn it", (id) => {
    const { frames, yaw } = play(SCHEMES[id], [{ key: "left", at: 0, hold: 0.5 }, { key: "back", at: 0.6, hold: 0.5 }, { key: "ahead", at: 1.2 }, { key: "right", at: 1.2 }], 2);
    expect(yaw).toBe(0);
    expect(at(frames, 0.2).left).toBeCloseTo(SCHEMES[id].side, 6);
    expect(at(frames, 0.8).ahead).toBeCloseTo(-SCHEMES[id].back, 6);
    // Ahead and right together: the diagonal, ahead and to the right in equal parts of a pace no faster than ahead alone.
    const both = at(frames, 1.5);
    expect(both.ahead).toBeCloseTo(Math.SQRT1_2, 6);
    expect(both.left).toBeCloseTo(-Math.SQRT1_2 * SCHEMES[id].side, 6);
  });

  it("Shift with ← or → turns the view at the steady rate instead of stepping aside", () => {
    const { frames, yaw } = play(SCHEMES.shooter, [{ key: "shift", at: 0, hold: 1.5 }, { key: "left", at: 0.5, hold: 1 }], 2);
    expect(yaw).toBeCloseTo(SCHEMES.shooter.rate, 0);
    expect(frames.every((f) => f.left === 0)).toBe(true);
  });

  it("a double tap of ↑ hurries while ↑ is held, and Shift no longer does", () => {
    const tapped = play(SCHEMES.shooter, [{ key: "ahead", at: 0, hold: 0.1 }, { key: "ahead", at: 0.25, hold: 1 }], 1);
    expect(at(tapped.frames, 0.6).hurry).toBe(true);
    const shifted = play(SCHEMES.shooter, [{ key: "shift", at: 0 }, { key: "ahead", at: 0 }], 1);
    expect(shifted.last.hurry).toBe(false);
  });
});

describe("look around, and tank", () => {
  it("look-around: a tap nudges, a held key turns slowly and steadily, and ↓ steps back", () => {
    const rate = SCHEMES["look-around"].rate;
    const tap = play(SCHEMES["look-around"], [{ key: "ahead", at: 0 }, { key: "left", at: 0.5, hold: 0.12 }], 1);
    // Keys land between frames, so a tap turns to within a frame of its length.
    expect(tap.yaw).toBeCloseTo(rate * 0.12, 0);
    const held = play(SCHEMES["look-around"], [{ key: "left", at: 0, hold: 2 }], 2.5);
    expect(at(held.frames, 1.5).yaw - at(held.frames, 0.5).yaw).toBeCloseTo(rate, 0);
    const back = play(SCHEMES["look-around"], [{ key: "back", at: 0 }], 0.5);
    expect(back.last.ahead).toBeCloseTo(-SCHEMES["look-around"].back, 6);
    expect(back.yaw).toBe(0);
  });

  it("tank: ← held turns at its steady rate while ↑ walks on, and ↓ backs", () => {
    const { frames } = play(SCHEMES.tank, [{ key: "ahead", at: 0, hold: 2 }, { key: "left", at: 0.5, hold: 1 }, { key: "back", at: 2.5 }], 3);
    expect(at(frames, 1.3).yaw - at(frames, 0.8).yaw).toBeCloseTo(SCHEMES.tank.rate / 2, 0);
    expect(at(frames, 1).ahead).toBe(1);
    expect(at(frames, 2.8).ahead).toBeCloseTo(-SCHEMES.tank.back, 6);
  });
});

describe("turns out of sight (blink, steps)", () => {
  it("blink: a held key only nudges, and a double tap turns a quarter at the darkest of a brief blink", () => {
    const { rate, nudgeFor, blink } = SCHEMES.blink;
    expect(play(SCHEMES.blink, [{ key: "left", at: 0, hold: 1 }], 1.5).yaw).toBeCloseTo(rate * nudgeFor, 0);
    const { frames, yaw } = play(SCHEMES.blink, [{ key: "left", at: 0, hold: 0.12 }, { key: "left", at: 0.3, hold: 0.12 }], 1);
    expect(yaw).toBeCloseTo(90, 0);
    expect(frames.filter((f) => f.dim > 0).length * DT).toBeCloseTo(blink, 1);
    const jump = frames.findIndex((f, i) => i > 0 && Math.abs(f.yaw - frames[i - 1]!.yaw) > 10);
    expect(frames[jump]!.dim).toBeGreaterThan(0.95);
  });

  it("blink: ↓ turns the person about under a blink, without stepping back", () => {
    const { frames, yaw } = play(SCHEMES.blink, [{ key: "back", at: 0, hold: 0.6 }], 1);
    expect(Math.abs(yaw)).toBeCloseTo(180, 0);
    expect(frames.every((f) => f.ahead === 0)).toBe(true);
  });

  it("steps: each press of ← or → turns its step at once, and holding turns no further", () => {
    const { yaw } = play(SCHEMES.steps, [{ key: "right", at: 0, hold: 1 }, { key: "right", at: 1.5, hold: 0.1 }], 2);
    expect(yaw).toBeCloseTo(-2 * SCHEMES.steps.snap, 6);
  });
});

describe("click to go", () => {
  it("the keys never walk, and a side key only nudges", () => {
    const { frames, yaw } = play(SCHEMES["click-to-go"], [{ key: "ahead", at: 0, hold: 1 }, { key: "right", at: 0, hold: 1 }], 1.5);
    expect(frames.every((f) => f.ahead === 0 && f.left === 0)).toBe(true);
    expect(yaw).toBeCloseTo(-SCHEMES["click-to-go"].rate * SCHEMES["click-to-go"].nudgeFor, 0);
  });
});

describe("tuning", () => {
  it("a scheme's numbers are its own: a slower rate turns more slowly", () => {
    const slow = { ...SCHEMES["look-around"], rate: 20 };
    const { frames } = play(slow, [{ key: "left", at: 0, hold: 2 }], 2.5);
    expect(at(frames, 1.5).yaw - at(frames, 0.5).yaw).toBeCloseTo(20, 0);
  });
});
