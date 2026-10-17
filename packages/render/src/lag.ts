// A change in vitality eases in. Each plant, batch of buildings and set of
// copies keeps two vitalities behind the one it was given: the shown
// vitality, which follows the given one, and where the shown one was a
// moment ago, which follows the shown one in turn. Its shaders show every
// step of its decline averaged between the two (`eased` in plant.ts), so a
// change starts gently, spreads every step over the vitality passed through,
// and comes to rest gently. At rest both equal the given vitality exactly,
// so every step stands where it does with no change at all.

import { CHANNEL_MATH } from "@gaia/realize";

/** A difference below this closes at once, so a thing at rest shows its steps exactly. */
const CLOSED = 1e-4;

/** Whatever is still easing in: each moves its own vitalities by a factor and says whether any is still moving. */
const closing = new Set<(keep: number) => boolean>();

/** How much of a difference each stage keeps over `dt` seconds. */
export const lagKept = (dt: number): number => Math.exp(-Math.max(0, dt) / CHANNEL_MATH.vitalityLag);

/**
 * One frame of a change easing in: the shown vitality closes on `target` by
 * `keep`, and where it was (shown + lag) closes on the new shown vitality by
 * `keep`. Returns the new shown vitality and lag, landing exactly on
 * `target` and 0 once both are too small to see.
 */
export function followVitality(shown: number, lag: number, target: number, keep: number): [number, number] {
  const was = shown + lag;
  let next = target + (shown - target) * keep;
  if (Math.abs(next - target) < CLOSED) next = target;
  const nextLag = (was - next) * keep;
  return [next, next === target && Math.abs(nextLag) < CLOSED ? 0 : nextLag];
}

/** Asks for `close` to be called each frame until it says nothing is still moving. */
export function closeEachFrame(close: (keep: number) => boolean): void {
  closing.add(close);
}

/**
 * Eases every change by `dt` seconds. The world calls it once a frame with
 * the frame's time, so a change eases in at the same pace however fast
 * frames come; a frame drawn with no time passing changes nothing.
 */
export function easeVitality(dt: number): void {
  if (dt <= 0 || closing.size === 0) return;
  const keep = lagKept(dt);
  for (const close of [...closing]) if (!close(keep)) closing.delete(close);
}

/** Brings every change to rest at once, for a script that sets vitality and wants to see where it settles. */
export function settleVitality(): void {
  for (const close of [...closing]) close(0);
  closing.clear();
}
