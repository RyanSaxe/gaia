// How the keys walk and turn a person who looks where they stand, with no body
// on screen. Every way of walking here is built for comfort: speeds are
// constant, nothing speeds up into a swing, a big turn never rotates on
// screen, and nothing moves the view but the person's own keys and hand
// (round 20's movement thread). The app shows face and go, which the
// reviewer asked for in round 21: a direction faces you that way at once,
// held walks you on, and while walking ← and → nudge your way. Each way is data (`SteerScheme`), so the
// walking playground (`?walk=playground`) switches and tunes them live; the
// app shows the one the terrain lab names.
// Pure, with no imports, so a page's prototype can run this file as it is.

/** The keys steering reads: the four ways, and Shift. */
export type WalkKey = "ahead" | "left" | "right" | "back" | "shift";

/** One way of walking, every number in it tunable. */
export interface SteerScheme {
  /** A few words, and one line saying what the keys and hand do. */
  readonly label: string;
  readonly name: string;
  /**
   * What ↑ ↓ ← → walk: ↑ and ↓ only (`ahead`), all four with ← and → stepping
   * aside (`strafe`), or nothing (`none`, a tap or click walks). With `face`,
   * a direction pressed while still faces the person that way at once, and
   * held walks them on forward; walking, ← and → nudge the way.
   */
  readonly walk: "ahead" | "strafe" | "none" | "face";
  /** How ← and → turn the view where they do not step aside: while held (`hold`), for a moment each press (`nudge`), or not. With `strafe`, Shift with them turns while held. */
  readonly turn: "hold" | "nudge" | "none";
  /** How a big turn happens: a double tap of ← or → turns a quarter and ↓ about, under a blink (`blink`); each press of ← or → turns `snap` degrees at once (`snap`); or none. */
  readonly big: "none" | "blink" | "snap";
  /** How the hand turns the view: dragging (`drag`), or the mouse captured by a click, as in desktop games (`pointer`). */
  readonly look: "drag" | "pointer";
  /** How hurrying is asked: Shift held, or a double tap of ↑, held. */
  readonly hurry: "shift" | "double-tap";
  /** Degrees a second the keys turn the view: one rate, never easing. */
  readonly rate: number;
  /** Where a key only nudges, seconds it turns each press. */
  readonly nudgeFor: number;
  /** Walking pace, meters a second; and backing and stepping aside, as shares of it. */
  readonly pace: number;
  readonly back: number;
  readonly side: number;
  /** A blink's length, seconds (with `face`, 0 is a cut), and a snap's turn, degrees. */
  readonly blink: number;
  readonly snap: number;
  /** With `face`: degrees a tap of ← or → nudges the walk, paid out at `rate`; degrees a second a side key held while walking keeps turning after its nudge (0 for none); and whether ↑ with ← or → from still faces the diagonal between. */
  readonly nudge: number;
  readonly keep: number;
  readonly diagonal: boolean;
  /** Degrees the view turns for each pixel the hand moves. */
  readonly sensitivity: number;
}

const BASE = { rate: 60, nudgeFor: 0.15, pace: 4.2, back: 0.4, side: 0.9, blink: 0.2, snap: 30, nudge: 8, keep: 30, diagonal: true, sensitivity: 0.26, look: "drag", hurry: "shift" } as const;
/** Every way of walking the playground offers, each with its own numbers. */
export const SCHEMES = {
  "face-and-go": { ...BASE, label: "Face and go", name: "A direction pressed while still faces you that way at once; held, you walk on; walking, ← → nudge your way; Shift hurries", walk: "face", turn: "none", big: "none", blink: 0.1 },
  shooter: { ...BASE, label: "Walk and look", name: "W A S D walk and step aside, a drag looks, Shift with ← → turns, a double tap of W hurries", walk: "strafe", turn: "hold", big: "none", back: 0.65, hurry: "double-tap" },
  "mouse-look": { ...BASE, label: "Mouse look", name: "A click captures the mouse to look, as in desktop games; W A S D walk and step aside; Esc lets go", walk: "strafe", turn: "hold", big: "none", back: 0.65, look: "pointer", sensitivity: 0.12, hurry: "double-tap" },
  "look-around": { ...BASE, label: "Look around", name: "← → turn slowly while held, a tap nudges, ↓ steps back", walk: "ahead", turn: "hold", big: "none", rate: 45 },
  blink: { ...BASE, label: "Blink turns", name: "A tap of ← → nudges; a double tap turns a quarter, and ↓ about, under a blink", walk: "ahead", turn: "nudge", big: "blink" },
  steps: { ...BASE, label: "Turn in steps", name: "Each press of ← → turns a step at once, as VR's snap turn; ↓ steps back", walk: "ahead", turn: "none", big: "snap" },
  tank: { ...BASE, label: "Tank", name: "↑ walks, ↓ backs, ← → turn at a steady rate while held", walk: "ahead", turn: "hold", big: "none", rate: 90, back: 0.65 },
  "click-to-go": { ...BASE, label: "Click to go", name: "A click walks you there; the keys only nudge", walk: "none", turn: "nudge", big: "none" },
} as const satisfies Readonly<Record<string, SteerScheme>>;
export type SteerSchemeId = keyof typeof SCHEMES;

/** A key down: when it was pressed, where the person faced then, and whether it turns them. */
interface Held {
  readonly at: number;
  readonly yaw: number;
  readonly turns: boolean;
}

/** The keys' hold on a person. */
export interface Steering {
  readonly scheme: SteerScheme;
  readonly down: ReadonlyMap<WalkKey, Held>;
  /** The last tap of a key let go, which a second press soon after makes a double tap. */
  readonly tapped: { readonly key: WalkKey; readonly at: number; readonly yaw: number } | null;
  /** A turn under a blink: when it began, the facing it turns to, and whether it has. */
  readonly blink: { readonly at: number; readonly to: number; readonly turned: boolean } | null;
  /** A turn made at once, radians, taken up by the next step. */
  readonly snapped: number;
  /** Whether a double tap of ↑ has the person hurrying while ↑ is held. */
  readonly hurrying: boolean;
  /** With `face`: a turn being decided, from where the person faced, at `decide`, by every key pressed since; nudges still to pay out, radians; and whether the keys walk them. */
  readonly pending: { readonly at: number; readonly from: number; readonly decide: number; readonly keys: ReadonlySet<WalkKey> } | null;
  readonly owed: number;
  readonly going: boolean;
  /** With `face`: when a key held after its turn sets the person walking, so a tap only turns them. */
  readonly goAt: number | null;
}

/** One step: the keys' hold after it, the facing, the walk as shares of the pace ahead and to the left of the view, whether hurrying, and how dark a blink has the view, 0 to 1. */
export interface Steered {
  readonly steering: Steering;
  readonly yaw: number;
  readonly ahead: number;
  readonly left: number;
  readonly hurry: boolean;
  readonly dim: number;
}

const DEG = Math.PI / 180;
/** A second press this soon after a tap is let go makes a double tap, seconds; a tap is a press shorter than this. */
const DOUBLE_TAP = 0.3;
const TAP = 0.2;

const smooth = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};
const isSide = (key: WalkKey): key is "left" | "right" => key === "left" || key === "right";
/** Left of where the person looks is +yaw. */
const sign = (key: "left" | "right"): number => (key === "left" ? 1 : -1);

export function steering(scheme: SteerScheme): Steering {
  return { scheme, down: new Map(), tapped: null, blink: null, snapped: 0, hurrying: false, pending: null, owed: 0, going: false, goAt: null };
}

/** Keys pressed this close together, from still, are one chord, as ↑ and ← for the diagonal, seconds. */
const CHORD = 0.05;
/** A key that turned the person sets them walking once held this long from its press, seconds, so a tap only turns them. */
const GO = 0.15;
const DIRECTIONS: readonly WalkKey[] = ["ahead", "left", "right", "back"];
const directionDown = (down: ReadonlyMap<WalkKey, Held>): boolean => DIRECTIONS.some((k) => down.has(k));

/** The turn a chord of keys asks, radians, left positive: ↓ about, ← or → a quarter, with ↑ the diagonal where it may, ↑ alone none. */
function facing(keys: ReadonlySet<WalkKey>, diagonal: boolean): number {
  const ahead = keys.has("ahead");
  if (keys.has("back") && !ahead) return Math.PI;
  const left = (keys.has("left") ? 1 : 0) - (keys.has("right") ? 1 : 0);
  return left === 0 ? 0 : left * (ahead && diagonal ? Math.PI / 4 : Math.PI / 2);
}

/** A turn to face a chord's way from `yaw`, decided once the chord has had its moment; it blinks only where it turns. */
function turnFrom(s: Steering, t: number, yaw: number, keys: ReadonlySet<WalkKey>, chord: boolean): Steering {
  const decide = t + (chord ? CHORD : 0);
  return blinkFor({ ...s, pending: { at: t, from: yaw, decide, keys } }, t);
}

/** Where the turn being decided turns at all and has no blink yet, one starts now, its darkest when the turn is made, which waits for it. */
function blinkFor(s: Steering, t: number): Steering {
  const { pending, scheme } = s;
  if (pending === null || s.blink !== null || scheme.blink <= 0 || facing(pending.keys, scheme.diagonal) === 0) return s;
  const decide = Math.max(pending.decide, t + scheme.blink / 2);
  return { ...s, pending: { ...pending, decide }, blink: { at: decide - scheme.blink / 2, to: pending.from, turned: false } };
}

/** Face and go: a press faces the person its way from still, and while walking nudges it or turns them about. */
function facePress(s: Steering, key: WalkKey, t: number, yaw: number): Steering {
  const down = new Map(s.down).set(key, { at: t, yaw, turns: s.going && isSide(key) });
  const next = { ...s, down };
  if (key === "shift") return next;
  // A key joining a turn still being decided, as ← just after ↑, makes one chord with it.
  if (s.pending !== null) return blinkFor({ ...next, pending: { ...s.pending, keys: new Set([...s.pending.keys, key]) } }, t);
  if (!s.going) return turnFrom(next, t, yaw, new Set([key]), s.scheme.diagonal);
  if (isSide(key)) return { ...next, owed: s.owed + sign(key) * s.scheme.nudge * DEG };
  if (key === "back") return turnFrom(next, t, yaw, new Set(["back"]), false);
  return next;
}

/** Whether ← and → turn the view steadily: with `strafe` while Shift is held too (checked each step), otherwise unless they only turn by a blink or a snap. */
const sideTurns = ({ walk, turn, big }: SteerScheme): boolean => walk === "strafe" || (turn !== "none" && big !== "snap");

/** A key is pressed at `t`, the person facing `yaw`. */
export function steerPress(s: Steering, key: WalkKey, t: number, yaw: number): Steering {
  if (s.down.has(key)) return s;
  if (s.scheme.walk === "face") return facePress(s, key, t, yaw);
  const { walk, big } = s.scheme;
  const double = s.tapped?.key === key && t - s.tapped.at <= DOUBLE_TAP;
  const tapped = double ? null : s.tapped;
  if (isSide(key) && walk !== "strafe") {
    if (big === "blink" && double && s.blink === null && s.tapped !== null) {
      // A quarter turn from where the person faced before the first tap, which takes back its nudge.
      return { ...s, down: new Map(s.down).set(key, { at: t, yaw, turns: false }), tapped, blink: { at: t, to: s.tapped.yaw + sign(key) * (Math.PI / 2), turned: false } };
    }
    if (big === "snap") return { ...s, down: new Map(s.down).set(key, { at: t, yaw, turns: false }), tapped, snapped: s.snapped + sign(key) * s.scheme.snap * DEG };
  }
  const down = new Map(s.down).set(key, { at: t, yaw, turns: isSide(key) && sideTurns(s.scheme) });
  if (key === "back" && big === "blink" && walk !== "strafe" && s.blink === null) return { ...s, down, tapped, blink: { at: t, to: yaw + Math.PI, turned: false } };
  if (key === "ahead" && s.scheme.hurry === "double-tap" && double) return { ...s, down, tapped, hurrying: true };
  return { ...s, down, tapped };
}

/** A key is let go at `t`; with no key, every key, as when the page loses focus. */
export function steerRelease(s: Steering, key: WalkKey | undefined, t: number): Steering {
  if (key === undefined) return { ...s, down: new Map(), tapped: null, hurrying: false, going: false };
  const held = s.down.get(key);
  if (held === undefined) return s;
  const down = new Map([...s.down].filter(([k]) => k !== key));
  // Face and go: letting every direction go stops the walk; a turn still being decided is made all the same.
  if (s.scheme.walk === "face") return { ...s, down, going: s.going && directionDown(down), goAt: directionDown(down) ? s.goAt : null };
  const tapped = t - held.at < TAP ? { key, at: t, yaw: held.yaw } : s.tapped;
  return { ...s, down, tapped, hurrying: key === "ahead" ? false : s.hurrying };
}

/** The person is set facing elsewhere, as a jump sets them: a blink or snap in flight and a tap waiting for its second are dropped. */
export function steerAlong(s: Steering): Steering {
  return { ...s, tapped: null, blink: null, snapped: 0, pending: null, owed: 0 };
}

/** Face and go's step: a decided turn made at once, nudges paid out at the steady rate, and a side key held while walking turning on slowly. */
function faceStep(s: Steering, t: number, yaw: number, dt: number): Steered {
  const sc = s.scheme;
  let steering = s;
  let y = yaw;
  if (s.pending !== null && t + dt >= s.pending.decide) {
    const turn = facing(s.pending.keys, sc.diagonal);
    y = s.pending.from + turn;
    // ↑ alone walks at once; a key that turned the person walks them on only once it is held past a tap.
    const walks = directionDown(s.down);
    steering = turn === 0 || steering.going ? { ...steering, pending: null, going: steering.going || walks } : { ...steering, pending: null, goAt: walks ? s.pending.at + GO : null };
  }
  if (steering.goAt !== null && t + dt >= steering.goAt) steering = { ...steering, going: directionDown(s.down), goAt: null };
  let dim = 0;
  if (s.blink !== null) {
    const k = (t + dt - s.blink.at) / sc.blink;
    dim = k < 0.5 ? smooth(k / 0.5) : smooth((1 - k) / 0.5);
    steering = { ...steering, blink: k >= 1 ? null : s.blink };
  }
  if (steering.owed !== 0) {
    const pay = Math.sign(steering.owed) * Math.min(Math.abs(steering.owed), sc.rate * DEG * dt);
    y += pay;
    steering = { ...steering, owed: steering.owed - pay };
  }
  if (steering.going && sc.keep > 0) {
    for (const [key, held] of s.down) {
      if (!isSide(key) || !held.turns) continue;
      const from = held.at + sc.nudge / sc.rate;
      y += sign(key) * sc.keep * DEG * Math.max(0, t + dt - Math.max(t, from));
    }
  }
  const ahead = steering.going && directionDown(s.down) ? 1 : 0;
  return { steering, yaw: y, ahead, left: 0, hurry: ahead > 0 && s.down.has("shift"), dim };
}

/** One step of `dt` seconds from `t`, the person facing `yaw`. */
export function steerStep(s: Steering, t: number, yaw: number, dt: number): Steered {
  if (s.scheme.walk === "face") return faceStep(s, t, yaw, dt);
  const sc = s.scheme;
  let steering: Steering = s.snapped === 0 ? s : { ...s, snapped: 0 };
  let y = yaw + s.snapped;
  let dim = 0;
  if (s.blink !== null) {
    const k = (t + dt - s.blink.at) / sc.blink;
    // The view turns at the blink's darkest, never on screen.
    const turn = !s.blink.turned && k >= 0.5;
    if (turn) y = s.blink.to;
    dim = k < 0.5 ? smooth(k / 0.5) : smooth((1 - k) / 0.5);
    steering = { ...steering, blink: k >= 1 ? null : turn ? { ...s.blink, turned: true } : s.blink };
  } else {
    // Each turning key turns the view at the one steady rate for the part of this step it turns: from its press, or
    // where it only nudges, for its first `nudgeFor` seconds. With `strafe`, only while Shift is held too.
    for (const [key, held] of s.down) {
      if (!isSide(key) || !held.turns || (sc.walk === "strafe" && !s.down.has("shift"))) continue;
      const until = sc.turn === "nudge" ? held.at + sc.nudgeFor : Infinity;
      y += sign(key) * sc.rate * DEG * Math.max(0, Math.min(t + dt, until) - Math.max(t, held.at));
    }
  }
  const on = (k: WalkKey): number => (s.down.has(k) ? 1 : 0);
  let ahead = 0;
  let left = 0;
  if (sc.walk === "ahead") {
    // ↓ walks back unless it turns the person about.
    const back = sc.big === "blink" ? 0 : on("back");
    ahead = on("ahead") && back ? 0 : on("ahead") ? 1 : back ? -sc.back : 0;
  } else if (sc.walk === "strafe") {
    const a = on("ahead") - on("back");
    const l = s.down.has("shift") ? 0 : on("left") - on("right");
    const n = Math.hypot(a, l);
    // A pair of keys walks the diagonal between them, no faster than either alone.
    if (n > 0) {
      ahead = (a / n) * (a > 0 ? 1 : sc.back);
      left = (l / n) * sc.side;
    }
  }
  const hurry = ahead > 0 && (sc.hurry === "shift" ? s.down.has("shift") : s.hurrying);
  return { steering, yaw: y, ahead, left, hurry, dim };
}
