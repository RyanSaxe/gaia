// Draws a commit tally on the start page card of a world whose code has moved
// on since the person last opened it: one graphite stroke per commit, grouped
// in fives, with the count in words below. The card flips to bare paper before
// the map is drawn, so the wait's sheet never shows the tally.

import { rand, seedOf } from "@gaia/schema";
import { SERIF } from "../immersive/map-names.ts";
import { PENCIL } from "../wait/map-wait.ts";

/** The most commits the tally draws as strokes, six groups of five. Past it, one stroke per commit is no longer readable, so the card shows only the number. */
export const TALLY_MOST = 30;

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty"];
/** Spells a count below 40 in words. */
const inWords = (n: number): string => (n < 20 ? (ONES[n] as string) : `${TENS[Math.floor(n / 10)] as string}${n % 10 === 0 ? "" : `-${ONES[n % 10] as string}`}`);

/**
 * The card's two lines of text: the number of commits since the person last opened the world, in words up to
 * `TALLY_MOST` and in figures past it. When the commit they opened is no longer in the history, the text says only
 * that the code has changed.
 */
export function tallyWords(commits: number | null): readonly [string, string] {
  const since = "since you last opened it";
  if (commits === null) return ["the code has changed", since];
  if (commits === 1) return ["one commit", since];
  return [`${commits <= TALLY_MOST ? inWords(commits) : commits.toLocaleString("en")} commits`, since];
}

/**
 * The tally's proportions as shares of the card's height: stroke height and width, the spacing between strokes, groups
 * and lines, and the text size. The text shrinks only to keep its longer line within the `wide` share of the card's
 * width. With six worlds on the table a card is a few centimeters wide, and the text is still readable.
 */
const TALLY = { stroke: 0.3, width: 0.016, apart: 0.05, gate: 0.09, gap: 0.08, line: 0.16, leading: 1.25, wide: 0.86 } as const;

/** A paper-toned halo drawn under the tally on a painting, so the strokes and text stand out from the paint. */
const PAPER_ROUND = { color: "rgba(241, 231, 207, 0.78)", widen: 3.2, blur: 0.012 } as const;

/**
 * Draws the tally for `commits`, centered on the `w` by `h` card face at (`x`, `y`) in `c`, with the text below it.
 * The same `seed` gives the same strokes. Past `TALLY_MOST` commits, or when `commits` is null, only the text is drawn.
 * With `onPaint`, the face is a painting, so the paper-toned halo is drawn first.
 */
export function drawTally(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, commits: number | null, seed: string, onPaint = false): void {
  const [first, second] = tallyWords(commits);
  c.save();
  c.font = `italic 100px ${SERIF}`;
  const widest = Math.max(c.measureText(first).width, c.measureText(second).width) / 100;
  const line = Math.min(TALLY.line * h, (TALLY.wide * w) / widest);
  const counted = commits !== null && commits <= TALLY_MOST ? commits : 0;
  const head = counted > 0 ? (TALLY.stroke + TALLY.gap) * h : 0;
  const top = y + (h - head - line * (1 + TALLY.leading)) / 2;
  c.lineCap = c.lineJoin = "round";
  /** Draws the whole tally in `color`, with every line `widen` times as wide and each pass's alpha scaled by `dark`. */
  const ink = (color: string, widen: number, dark: number): void => {
    const r = rand(seedOf(`tally:${seed}`));
    c.strokeStyle = c.fillStyle = color;
    if (counted > 0) {
      // Each group of five is four vertical strokes with the fifth across them.
      const gates = Math.ceil(counted / 5);
      const span = gates * 3 * TALLY.apart * h + (gates - 1) * TALLY.gate * h;
      let left = x + (w - span) / 2;
      for (let g = 0; g < gates; g++) {
        const n = Math.min(5, counted - g * 5);
        const pass = (x0: number, y0: number, x1: number, y1: number): void => {
          // Each stroke is two light, slightly offset passes, as when a hand goes over a line twice.
          for (let k = 0; k < 2; k++) {
            c.globalAlpha = r.range(0.62, 0.85) * dark;
            c.lineWidth = TALLY.width * h * r.range(0.8, 1.15) * widen;
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
    c.globalAlpha = dark;
    c.font = `italic ${line.toFixed(1)}px ${SERIF}`;
    c.textAlign = "center";
    c.textBaseline = "top";
    const words = (text: string, at: number): void => {
      if (widen > 1) {
        c.lineWidth = line * 0.09 * widen;
        c.strokeText(text, x + w / 2, at);
      }
      c.fillText(text, x + w / 2, at);
    };
    words(first, top + head);
    words(second, top + head + line * TALLY.leading);
  };
  if (onPaint) {
    c.filter = `blur(${(PAPER_ROUND.blur * h).toFixed(1)}px)`;
    ink(PAPER_ROUND.color, PAPER_ROUND.widen, 1);
    c.filter = "none";
  }
  ink(PENCIL.graphite, 1, 1);
  c.restore();
}
