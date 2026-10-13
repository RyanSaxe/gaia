import { describe, expect, it } from "vitest";
import { SCHEMES, type SteerScheme, type SteerSchemeId, type WalkKey, keysLine, steerPress, steerRelease, steerStep, steering } from "@gaia/terrain";

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
    // Long enough for a turn asked for before every key was let go to be made.
    const { frames, last } = play(scheme, gestures, 12);
    for (const f of frames) expect(Math.hypot(f.ahead, f.left)).toBeLessThanOrEqual(1 + 1e-9);
    expect(last.ahead).toBe(0);
    expect(last.left).toBe(0);
    expect(at(frames, 11.5).yaw).toBe(last.yaw);
  });
});

describe("face and go", () => {
  const go = SCHEMES["face-and-go"];
  const cut = { ...go, bigTurn: "cut" } as const;
  const quick = { ...go, bigTurn: "quick" } as const;
  const walkInto = { ...go, bigTurn: "walk" } as const;
  const held = go;
  /** Every change of facing from frame to frame. */
  const turns = (frames: readonly { yaw: number }[]) => frames.slice(1).map((f, i) => f.yaw - frames[i]!.yaw).filter((d) => Math.abs(d) > 1e-9);
  const steady = deg(go.rate * (Math.PI / 180)) * DT;

  it("the app's own: held nudges only, with ↓ walking back", () => {
    expect(go.bigTurn).toBe("held");
    expect(keysLine(go)).toContain("↓ walks back");
  });

  it("walking into it, ← from still walks at once and curves round at the steady rate until facing left", () => {
    const { frames, yaw } = play(walkInto, [{ key: "left", at: 0, hold: 3 }], 3.5);
    expect(at(frames, 0.2).ahead).toBe(1);
    expect(at(frames, 0.8).yaw).toBeCloseTo(go.rate * 0.75, -1);
    expect(yaw).toBeCloseTo(90, 6);
    for (const d of turns(frames)) expect(Math.abs(d)).toBeLessThanOrEqual(steady + 1e-9);
  });

  it("walking into it, ↓ turns about in place at the steady rate, then walks on if still held", () => {
    const { frames, yaw } = play(walkInto, [{ key: "back", at: 0, hold: 4.5 }], 5);
    expect(yaw).toBeCloseTo(180, 6);
    expect(at(frames, 1.5).ahead).toBe(0);
    expect(at(frames, 4).ahead).toBe(1);
    for (const d of turns(frames)) expect(Math.abs(d)).toBeLessThanOrEqual(steady + 1e-9);
  });

  it.each([["left", 90], ["right", -90], ["back", 180], ["ahead", 0]] as const)("as a cut, from still %s faces that way in one frame", (key, to) => {
    const { frames, yaw } = play(cut, [{ key, at: 0.2, hold: 0.1 }], 1);
    expect(yaw).toBeCloseTo(to, 6);
    if (to !== 0) expect(turns(frames)).toEqual([expect.closeTo(to, 6)]);
  });

  it("as a cut, held walks on forward the new way; a tap only turns; still again, ← turns another quarter and ↑ goes on ahead", () => {
    const heldOn = play(cut, [{ key: "left", at: 0, hold: 1 }], 1.5);
    expect(heldOn.yaw).toBeCloseTo(90, 6);
    expect(at(heldOn.frames, 0.5).ahead).toBe(1);
    // A tap as a hand makes it, a tenth of a second.
    const tap = play(cut, [{ key: "left", at: 0, hold: 0.1 }], 0.5);
    expect(tap.frames.every((f) => f.ahead === 0)).toBe(true);
    expect(play(cut, [{ key: "left", at: 0, hold: 0.1 }, { key: "left", at: 0.5, hold: 0.1 }], 1).yaw).toBeCloseTo(180, 6);
    const ahead = play(cut, [{ key: "left", at: 0, hold: 0.5 }, { key: "ahead", at: 1, hold: 0.5 }], 2);
    expect(ahead.yaw).toBeCloseTo(90, 6);
    expect(at(ahead.frames, 1.3).ahead).toBe(1);
  });

  it("as a quick turn, a quarter turns at one constant speed in its time, never easing, then walks on", () => {
    const { frames, yaw } = play(quick, [{ key: "left", at: 0, hold: 1 }], 1.5);
    expect(yaw).toBeCloseTo(90, 6);
    const ds = turns(frames);
    const speed = (90 / quick.quick) * DT;
    for (const d of ds.slice(0, -1)) expect(d).toBeCloseTo(speed, 6);
    expect(ds.length * DT).toBeCloseTo(quick.quick, 1);
    expect(at(frames, 0.2).ahead).toBe(0);
    expect(at(frames, 0.6).ahead).toBe(1);
    // ↓ turns twice as far at the same speed.
    expect(turns(play(quick, [{ key: "back", at: 0, hold: 0.1 }], 1).frames).length * DT).toBeCloseTo(2 * quick.quick, 1);
  });

  it("with held nudges only, holding ← turns at the steady rate standing, never jumping or walking, and a tap nudges", () => {
    const { frames, yaw } = play(held, [{ key: "left", at: 0, hold: 1.5 }], 2);
    expect(yaw).toBeCloseTo(go.rate * 1.5, 0);
    for (const d of turns(frames)) expect(Math.abs(d)).toBeLessThanOrEqual(steady + 1e-9);
    expect(frames.every((f) => f.ahead === 0)).toBe(true);
    expect(play(held, [{ key: "left", at: 0, hold: 0.1 }], 1).yaw).toBeCloseTo(go.nudge, 6);
  });

  it("with held nudges only, ↓ walks back at its share of the pace, still facing ahead, and turns only with ← or →", () => {
    const back = play(held, [{ key: "back", at: 0, hold: 2 }], 2.5);
    expect(at(back.frames, 1).ahead).toBeCloseTo(-go.back, 6);
    expect(back.frames.every((f) => f.yaw === 0)).toBe(true);
    expect(back.last.ahead).toBe(0);
    const turning = play(held, [{ key: "back", at: 0, hold: 2 }, { key: "left", at: 0.5, hold: 1 }], 2.5);
    expect(at(turning.frames, 1).ahead).toBeCloseTo(-go.back, 6);
    expect(turning.yaw).toBeCloseTo(go.rate, 0);
    // ↑ and ↓ together stand.
    expect(at(play(held, [{ key: "ahead", at: 0 }, { key: "back", at: 0 }], 0.5).frames, 0.3).ahead).toBe(0);
  });

  it("a held side key turns at the steady rate however its press falls between frames", () => {
    // As the page steps: a key pressed between frames is seen at the next frame, which steps on from then.
    const step = 1 / 60;
    for (const pressed of [0.101, 0.105, 0.112]) {
      let s = steering(held);
      let yaw = 0;
      let fastest = 0;
      for (let t = 0; t < 1.5; t += step) {
        if (t >= pressed && !s.down.has("left")) s = steerPress(s, "left", pressed, yaw);
        const next = steerStep(s, t, yaw, step);
        fastest = Math.max(fastest, Math.abs(next.yaw - yaw) / step);
        s = next.steering;
        yaw = next.yaw;
      }
      expect(deg(fastest)).toBeLessThanOrEqual(go.rate + 1e-6);
    }
  });

  it("with held nudges only, ↑ walks ahead and ← held turns the walk at the steady rate", () => {
    const walking = play(held, [{ key: "ahead", at: 0, hold: 2 }, { key: "left", at: 0.5, hold: 1 }], 2.5);
    expect(at(walking.frames, 1).ahead).toBe(1);
    expect(walking.yaw).toBeCloseTo(go.rate, 0);
  });

  it("in every way of big turns, nothing dims the view", () => {
    for (const scheme of [go, cut, quick, held]) expect(play(scheme, [{ key: "back", at: 0, hold: 0.1 }, { key: "left", at: 1, hold: 0.1 }], 5).frames.every((f) => f.dim === 0)).toBe(true);
  });

  it("walking, a tap of a side key nudges the way a few degrees at the steady rate, never in one jump", () => {
    const { frames, yaw } = play({ ...cut, keep: 0 }, [{ key: "ahead", at: 0, hold: 2 }, { key: "right", at: 1, hold: 0.1 }], 2);
    expect(yaw).toBeCloseTo(-go.nudge, 6);
    for (const d of turns(frames)) expect(Math.abs(d)).toBeLessThanOrEqual(steady + 1e-9);
    expect(at(frames, 1.5).ahead).toBe(1);
  });

  it("walking, a side key held keeps turning slowly after its nudge, and not at all with keep at 0", () => {
    const kept = play(cut, [{ key: "ahead", at: 0, hold: 3 }, { key: "left", at: 1, hold: 1.5 }], 3);
    expect(kept.yaw).toBeCloseTo(go.nudge + go.keep * (1.5 - go.nudge / go.rate), 0);
    const not = play({ ...cut, keep: 0 }, [{ key: "ahead", at: 0, hold: 3 }, { key: "left", at: 1, hold: 1.5 }], 3);
    expect(not.yaw).toBeCloseTo(go.nudge, 6);
  });

  it("↑ with ← from still faces the diagonal; without it, ↑ walks at once and ← nudges that walk", () => {
    expect(play(cut, [{ key: "ahead", at: 0, hold: 0.5 }, { key: "left", at: 0.02, hold: 0.5 }], 1).yaw).toBeCloseTo(45, 6);
    const off = play({ ...cut, diagonal: false, keep: 0 }, [{ key: "ahead", at: 0, hold: 0.5 }, { key: "left", at: 0.02, hold: 0.5 }], 1);
    expect(off.yaw).toBeCloseTo(go.nudge, 6);
    expect(at(off.frames, 0.1).ahead).toBe(1);
  });

  it("Shift hurries the walk ahead, never the walk back", () => {
    expect(at(play(go, [{ key: "shift", at: 0 }, { key: "ahead", at: 0.1 }], 1).frames, 0.5).hurry).toBe(true);
    expect(at(play(go, [{ key: "shift", at: 0 }, { key: "back", at: 0.1 }], 1).frames, 0.5).hurry).toBe(false);
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
