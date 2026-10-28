// Steers the person from the keyboard. A tap of a side key turns the view a
// small step, and holding the key keeps turning at the same rate. Walking
// backward keeps the facing. A constant turn rate limits unexpected camera
// acceleration.

/** The four direction keys and Shift. */
export type WalkKey = "ahead" | "left" | "right" | "back" | "shift";

const DEG = Math.PI / 180;
/** Steering constants. The design rationale is in docs/design-system.md#terrain-walking-and-travel. */
export const STEER = {
  /** Turn rate in radians per second for both nudges and held keys, with no easing. */
  rate: 60 * DEG,
  /** Radians a tap of ← or → turns the view, at `rate`. */
  nudge: 8 * DEG,
  /** ↓ walks backward at this share of walking pace. */
  back: 0.65,
} as const;

/** Steering state: each held key with its press time, and the nudge angle still to turn (`owed`) in radians. */
export interface Steering {
  readonly down: ReadonlyMap<WalkKey, number>;
  readonly owed: number;
}

/** One step's result: the new steering state, the facing, the walk as a share of forward pace (negative when backing), and whether Shift hurries it. */
export interface Steered {
  readonly steering: Steering;
  readonly yaw: number;
  readonly ahead: number;
  readonly hurry: boolean;
}

const isSide = (key: WalkKey): key is "left" | "right" => key === "left" || key === "right";
/** Turning left increases yaw. */
const sign = (key: "left" | "right"): number => (key === "left" ? 1 : -1);

export function steering(): Steering {
  return { down: new Map(), owed: 0 };
}

/** Records a key press at time `t`. ← or → adds a nudge. */
export function steerPress(s: Steering, key: WalkKey, t: number): Steering {
  if (s.down.has(key)) return s;
  return { down: new Map(s.down).set(key, t), owed: isSide(key) ? s.owed + sign(key) * STEER.nudge : s.owed };
}

/** Records a key release. With no key, it releases every key, as when the page loses focus. */
export function steerRelease(s: Steering, key?: WalkKey): Steering {
  if (key === undefined) return { ...s, down: new Map() };
  if (!s.down.has(key)) return s;
  return { ...s, down: new Map([...s.down].filter(([k]) => k !== key)) };
}

/** Drops the nudges still owed, for when something else sets the facing, such as a jump. */
export function steerAlong(s: Steering): Steering {
  return { ...s, owed: 0 };
}

/** One step of `dt` seconds from `t`, the person facing `yaw`. */
export function steerStep(s: Steering, t: number, yaw: number, dt: number): Steered {
  let y = yaw;
  let owed = s.owed;
  // Owed nudges turn at `STEER.rate`. A held key turns only in the time the nudges leave in the step, and only after
  // its own nudge's duration, so the two never add up however a press falls between frames.
  const pay = Math.sign(owed) * Math.min(Math.abs(owed), STEER.rate * dt);
  y += pay;
  owed -= pay;
  const spent = Math.abs(pay) / STEER.rate;
  for (const [key, at] of s.down) {
    if (!isSide(key)) continue;
    const from = Math.max(t + spent, at + STEER.nudge / STEER.rate);
    y += sign(key) * STEER.rate * Math.max(0, t + dt - from);
  }
  const forward = s.down.has("ahead");
  // ↓ walks backward and keeps the facing. ↑ and ↓ together stop. Shift hurries only forward walking.
  const ahead = s.down.has("back") ? (forward ? 0 : -STEER.back) : forward ? 1 : 0;
  return { steering: { ...s, owed }, yaw: y, ahead, hurry: ahead > 0 && s.down.has("shift") };
}
