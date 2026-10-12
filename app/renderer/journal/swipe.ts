// A swipe sideways on a trackpad, or the wheel, turns the journal's pages one
// at a time: however long a gesture runs, its momentum included, it turns one
// page.

/** How far a gesture travels before it turns a page, px, and how long it rests before it is over, ms. */
export const SWIPE = { reach: 40, rest: 200 } as const;

/**
 * Reads gestures from wheel events, each event's deltas and when it came: the
 * larger of its two deltas adds up until the sum reaches `reach`, which turns
 * a page, forward (1) for a swipe to the left or a scroll down and back (-1)
 * the other way. The rest of that gesture turns nothing, until `rest` passes
 * with no event.
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
