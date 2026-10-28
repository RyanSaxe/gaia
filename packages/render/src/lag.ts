// Eases changes in vitality. Each plant, building batch and set of copies
// keeps two values behind its given vitality: the shown vitality, which
// follows the given one, and its value a moment ago, which follows the shown
// one. The shaders average every step of decline between the two (`eased` in
// plant.ts), so a change starts and ends gently, and at rest both equal the
// given vitality exactly.

import { CHANNEL_MATH } from "@gaia/realize";

/** A difference below this closes at once, so a thing at rest shows its steps exactly. */
const CLOSED = 1e-4;

/** Every closer still easing. Each moves its own vitalities by a factor and returns whether any is still moving. */
const closing = new Set<(keep: number) => boolean>();

/** How much of a difference each stage keeps over `dt` seconds. */
export const lagKept = (dt: number): number => Math.exp(-Math.max(0, dt) / CHANNEL_MATH.vitalityLag);

/**
 * One frame of easing. The shown vitality closes on `target` by `keep`, and
 * its previous value, shown + lag, closes on the new shown vitality by
 * `keep`. Returns the new shown vitality and lag, which land exactly on
 * `target` and 0 once both differences are below `CLOSED`.
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
 * frames come. A frame with no time passing changes nothing.
 */
export function easeVitality(dt: number): void {
  if (dt <= 0 || closing.size === 0) return;
  const keep = lagKept(dt);
  for (const close of [...closing]) if (!close(keep)) closing.delete(close);
}

/** Brings every change to rest at once, for a script that sets vitality and checks where it settles. */
export function settleVitality(): void {
  for (const close of [...closing]) close(0);
  closing.clear();
}
