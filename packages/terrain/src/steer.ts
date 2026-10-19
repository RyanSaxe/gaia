// Keyboard steering. A tap nudges the view; holding a side key continues
// at the same angular speed. Backward walking preserves the facing. Keeping
// turns at a constant rate limits unexpected camera acceleration.

/** The keys steering reads: the four ways, and Shift. */
export type WalkKey = "ahead" | "left" | "right" | "back" | "shift";

const DEG = Math.PI / 180;
/** Steering constants; design rationale is in docs/design-system.md#terrain-walking-and-travel. */
export const STEER = {
  /** The one rate the keys turn the view at, radians a second: a nudge's and a held key's alike, never easing. */
  rate: 60 * DEG,
  /** A tap of ← or → turns the person this far, radians, at `rate`. */
  nudge: 8 * DEG,
  /** ↓ walks backward at this share of walking pace. */
  back: 0.65,
} as const;

/** The keys' hold on a person: each key down with when it was pressed, and the nudges still to turn, radians. */
export interface Steering {
  readonly down: ReadonlyMap<WalkKey, number>;
  readonly owed: number;
}

/** One step: the keys' hold after it, the facing, the walk as a share of the pace ahead (negative backing), and whether hurrying. */
export interface Steered {
  readonly steering: Steering;
  readonly yaw: number;
  readonly ahead: number;
  readonly hurry: boolean;
}

const isSide = (key: WalkKey): key is "left" | "right" => key === "left" || key === "right";
/** Left of where the person looks is +yaw. */
const sign = (key: "left" | "right"): number => (key === "left" ? 1 : -1);

export function steering(): Steering {
  return { down: new Map(), owed: 0 };
}

/** A key is pressed at `t`: ← or → nudges. */
export function steerPress(s: Steering, key: WalkKey, t: number): Steering {
  if (s.down.has(key)) return s;
  return { down: new Map(s.down).set(key, t), owed: isSide(key) ? s.owed + sign(key) * STEER.nudge : s.owed };
}

/** A key is let go; with no key, every key, as when the page loses focus. */
export function steerRelease(s: Steering, key?: WalkKey): Steering {
  if (key === undefined) return { ...s, down: new Map() };
  if (!s.down.has(key)) return s;
  return { ...s, down: new Map([...s.down].filter(([k]) => k !== key)) };
}

/** The person is set facing elsewhere, as a jump sets them: the nudges still owed are dropped. */
export function steerAlong(s: Steering): Steering {
  return { ...s, owed: 0 };
}

/** One step of `dt` seconds from `t`, the person facing `yaw`. */
export function steerStep(s: Steering, t: number, yaw: number, dt: number): Steered {
  let y = yaw;
  let owed = s.owed;
  // The nudges owed turn at the steady rate; a held key turns on only in what they leave of the step, so the two
  // never add up, however a press falls between frames.
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
  // ↓ walks back, still facing ahead; ↑ and ↓ together stand. Shift hurries only the walk ahead.
  const ahead = s.down.has("back") ? (forward ? 0 : -STEER.back) : forward ? 1 : 0;
  return { steering: { ...s, owed }, yaw: y, ahead, hurry: ahead > 0 && s.down.has("shift") };
}
