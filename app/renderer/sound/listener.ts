// Turns each moment of what the person hears into soundscape calls: bed
// levels 15 times a second, a footfall at each stride, the journal's paper
// sounds as the book opens, turns and shuts, and music updates. The page
// drives it from each frame, and a recorded walk drives it from its log, so
// both sound the same.

import type { Earshot } from "../terrain/world.ts";
import { cadence, footing, hear } from "./hearing.ts";
import type { Music } from "./music.ts";
import type { Soundscape } from "./soundscape.ts";

/** The journal's state: open or shut, and whether a page is turning. */
export interface BookState {
  readonly open: boolean;
  readonly turning: boolean;
}

/** One moment of a walk: the time in seconds on the audio clock, what the person hears, and the journal's state. */
export interface Moment {
  readonly t: number;
  readonly ear: Earshot;
  readonly book: BookState;
}

/** Seconds between bed level updates. The levels ease between updates, so updating more often only adds work. */
const MIX_EVERY = 1 / 15;
/** Seconds after which a page still turning counts as a riffle, whose sound plays under the first page turn's. */
const RIFFLE_AFTER = 0.5;

export interface Listener {
  hear(m: Moment): void;
}

export function createListener(scape: Soundscape, music: Music | null): Listener {
  let mixed = -Infinity;
  let was: Moment | null = null;
  // The stride's phase. A footfall plays each time it passes a whole number, and starting at 0.6 brings the first soon
  // after setting off.
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
