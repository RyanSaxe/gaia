// Turns a sideways trackpad swipe or a wheel gesture into one page turn,
// however long the gesture and its momentum run.

/** The px a gesture travels before it turns a page, and the ms without events that end the gesture. */
export const SWIPE = { reach: 40, rest: 200 } as const;

/**
 * Reads gestures from wheel events, given each event's deltas and time. The
 * larger of the two deltas adds up until the sum reaches `reach`, which
 * returns 1 (forward) for a swipe to the left or a scroll down, or -1 for the
 * other way. The rest of that gesture returns null until `rest` ms pass with
 * no event.
 */
export function swipes(reach: number = SWIPE.reach, rest: number = SWIPE.rest): (dx: number, dy: number, at: number) => 1 | -1 | null {
  let sum = 0;
  let last = Number.NEGATIVE_INFINITY;
  let turned = false;
  return (dx, dy, at) => {
    if (at - last > rest) {
      sum = 0;
      turned = false;
    }
    last = at;
    if (turned) return null;
    sum += Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(sum) < reach) return null;
    turned = true;
    return sum > 0 ? 1 : -1;
  };
}
