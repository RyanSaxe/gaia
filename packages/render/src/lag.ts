// A change in vitality eases in. Each plant, batch of buildings and set of
// copies keeps how far its shown vitality lags behind where it was a moment
// ago, and its shaders show every step of its decline averaged over the
// vitality passed through since (`eased` in plant.ts). The lag closes to
// nothing over a fraction of a second, so at rest every step stands exactly
// where it does, and only a change between vitalities is spread out.

import { CHANNEL_MATH } from "@gaia/realize";

/** A lag below this closes at once, so a thing at rest shows its steps exactly. */
const CLOSED = 1e-4;

/** Whatever has a lag still closing: each eases its own by a factor and says whether any is left. */
const closing = new Set<(keep: number) => boolean>();

/** A lag shrunk by `keep`, and nothing once it is too small to see. */
export const closeLag = (lag: number, keep: number): number => (Math.abs(lag * keep) < CLOSED ? 0 : lag * keep);

/** How far a lag keeps of itself over `dt` seconds. */
export const lagKept = (dt: number): number => Math.exp(-Math.max(0, dt) / CHANNEL_MATH.vitalityLag);

/** Asks for `close` to be called each frame until it says no lag is left. */
export function closeEachFrame(close: (keep: number) => boolean): void {
  closing.add(close);
}

/**
 * Closes every lag by `dt` seconds. The world calls it once a frame with the
 * frame's time, so a change eases in at the same pace however fast frames
 * come; a frame drawn with no time passing changes nothing.
 */
export function easeVitality(dt: number): void {
  if (dt <= 0 || closing.size === 0) return;
  const keep = lagKept(dt);
  for (const close of [...closing]) if (!close(keep)) closing.delete(close);
}

/** Closes every lag at once, for a script that sets vitality and wants to see where it settles. */
export function settleVitality(): void {
  for (const close of [...closing]) close(0);
  closing.clear();
}
