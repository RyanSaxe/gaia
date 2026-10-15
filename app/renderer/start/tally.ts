// The tally on the card of a world whose code has moved on since the person
// last opened it: a stroke of the wait's graphite pencil for each commit,
// gated in fives, with how many in words under it. It is drawn on the bare
// card and, once the card is chosen, on the wait's sheet in the same place,
// as pencil on its paper, so the sheet the card becomes has it too and each
// wash takes it away in the measure that it paints.

import { rand, seedOf } from "@gaia/schema";
import { SERIF } from "../immersive/map-names.ts";
import { PENCIL } from "../wait/map-wait.ts";

/** The most commits the tally counts in strokes, six gates of five: past it a stroke a commit no longer reads, so the card only writes the number. */
export const TALLY_MOST = 30;

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty"];
/** A count up to the tally's most in words. */
const inWords = (n: number): string => (n < 20 ? (ONES[n] as string) : `${TENS[Math.floor(n / 10)] as string}${n % 10 === 0 ? "" : `-${ONES[n % 10] as string}`}`);

/**
 * What the card says, in two lines: how many commits since the person last opened the world, in words while the tally
 * counts them and in figures past it; or, when the commit they opened is no longer in the history, only that the code
 * has changed since.
 */
export function tallyWords(commits: number | null): readonly [string, string] {
  const since = "since you last opened it";
  if (commits === null) return ["the code has changed", since];
  if (commits === 1) return ["one commit", since];
  return [`${commits <= TALLY_MOST ? inWords(commits) : commits.toLocaleString("en")} commits`, since];
}

/**
 * The tally's proportions, as shares of the card's height: a stroke's height and width, the room between strokes,
 * gates and lines, and the words' size, smaller only so their longer line keeps this share of the card's width. Six
 * worlds on the table make a card a few centimeters wide, and the words still read.
 */
const TALLY = { stroke: 0.3, width: 0.016, apart: 0.05, gate: 0.09, gap: 0.08, line: 0.16, leading: 1.25, wide: 0.86 } as const;

/**
 * Draws the tally for `commits` on the card face `w` by `h` at (`x`, `y`) of `c`, the same strokes for the same
 * `seed`, with the words under it, in the middle of the card. Past `TALLY_MOST` commits, or with `commits` null, there
 * are only the words.
 */
export function drawTally(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, commits: number | null, seed: string): void {
  const r = rand(seedOf(`tally:${seed}`));
  const [first, second] = tallyWords(commits);
  c.save();
  c.font = `italic 100px ${SERIF}`;
  const widest = Math.max(c.measureText(first).width, c.measureText(second).width) / 100;
  const line = Math.min(TALLY.line * h, (TALLY.wide * w) / widest);
  const counted = commits !== null && commits <= TALLY_MOST ? commits : 0;
  const head = counted > 0 ? (TALLY.stroke + TALLY.gap) * h : 0;
  let top = y + (h - head - line * (1 + TALLY.leading)) / 2;
  c.strokeStyle = c.fillStyle = PENCIL.graphite;
  c.lineCap = "round";
  if (counted > 0) {
    // Four strokes down, then the fifth across them, a gate at a time.
    const gates = Math.ceil(counted / 5);
    const span = gates * 3 * TALLY.apart * h + (gates - 1) * TALLY.gate * h;
    let left = x + (w - span) / 2;
    for (let g = 0; g < gates; g++) {
      const n = Math.min(5, counted - g * 5);
      const pass = (x0: number, y0: number, x1: number, y1: number): void => {
        // Each stroke two light passes of the pencil, a little apart, as a hand goes over a line.
        for (let k = 0; k < 2; k++) {
          c.globalAlpha = r.range(0.62, 0.85);
          c.lineWidth = TALLY.width * h * r.range(0.8, 1.15);
          const j = TALLY.width * h * 0.6;
          c.beginPath();
          c.moveTo(x0 + r.range(-j, j), y0 + r.range(-j, j));
          c.lineTo(x1 + r.range(-j, j), y1 + r.range(-j, j));
          c.stroke();
        }
      };
      for (let k = 0; k < Math.min(4, n); k++) {
        const sx = left + k * TALLY.apart * h + r.range(-0.08, 0.08) * TALLY.apart * h;
        pass(sx, top + r.range(0, 0.06) * TALLY.stroke * h, sx + r.range(-0.12, 0.04) * TALLY.apart * h, top + TALLY.stroke * h * r.range(0.94, 1));
      }
      if (n === 5) pass(left - 0.5 * TALLY.apart * h, top + TALLY.stroke * h * 0.78, left + 3.5 * TALLY.apart * h, top + TALLY.stroke * h * 0.2);
      left += 3 * TALLY.apart * h + TALLY.gate * h;
    }
  }
  top += head;
  c.globalAlpha = 1;
  c.font = `italic ${line.toFixed(1)}px ${SERIF}`;
  c.textAlign = "center";
  c.textBaseline = "top";
  c.fillText(first, x + w / 2, top);
  c.fillText(second, x + w / 2, top + line * TALLY.leading);
  c.restore();
}
