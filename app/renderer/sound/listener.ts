// Turns what the person hears, moment by moment, into what the soundscape
// plays: the beds' levels a few times a second, a footfall each time the
// stride comes round, and the journal's paper as the book opens, turns and
// shuts, with the music following along. The page drives it live from each
// frame, and a recorded walk drives it from its log, so both sound alike.

import type { Earshot } from "../terrain/world.ts";
import { cadence, footing, hear } from "./hearing.ts";
import type { Music } from "./music.ts";
import type { Soundscape } from "./soundscape.ts";

/** The journal as it lies: open or shut, and whether a leaf is turning. */
export interface BookState {
  readonly open: boolean;
  readonly turning: boolean;
}

/** One moment of a walk: seconds on the sound's clock, what the person hears, and the book. */
export interface Moment {
  readonly t: number;
  readonly ear: Earshot;
  readonly book: BookState;
}

/** How often the beds' levels are set, seconds: they ease between, so more often only adds work. */
const MIX_EVERY = 1 / 15;
/** A leaf still turning this long after it began is a riffle, seconds, and its sound comes in under the first leaf's. */
const RIFFLE_AFTER = 0.5;

export interface Listener {
  hear(m: Moment): void;
}

export function createListener(scape: Soundscape, music: Music | null): Listener {
  let mixed = -Infinity;
  let was: Moment | null = null;
  // The stride's phase: a footfall each time it passes a whole number, the first soon after setting off.
  let stride = 0.6;
  let foot = 0;
  let turnFrom: number | null = null;
  let riffle: { stop(t: number): void } | null = null;
  return {
    hear(m) {
      if (m.t - mixed >= MIX_EVERY) {
        scape.at(m.t, hear(m.ear));
        music?.at(m.t, m.ear);
        mixed = m.t;
      }
      const dt = was === null ? 0 : Math.max(0, m.t - was.t);
      const rate = cadence(m.ear);
      if (rate === 0) stride = 0.6;
      else {
        stride += rate * dt;
        if (stride >= 1) {
          stride -= Math.floor(stride);
          scape.step(m.t, footing(m.ear), foot++ % 2 === 0 ? -1 : 1);
        }
      }
      const book = m.book;
      const before = was?.book ?? { open: false, turning: false };
      if (book.open && !before.open) scape.paper(m.t, "open");
      if (!book.open && before.open) scape.paper(m.t, "shut");
      if (book.turning && !before.turning) {
        turnFrom = m.t;
        scape.paper(m.t, "turn");
      }
      if (book.turning && turnFrom !== null && riffle === null && m.t - turnFrom >= RIFFLE_AFTER) riffle = scape.paper(m.t, "riffle");
      if (!book.turning) {
        riffle?.stop(m.t);
        riffle = null;
        turnFrom = null;
      }
      was = m;
    },
  };
}
