// Lettering for every name painted in the world, on a building's signboard,
// a tree's plaque, a fingerpost's arm or a boundary stone: the name always
// fits its board. It is set on one line as large as the board allows; a name
// too long for that breaks onto two lines where a person would break it
// (after a slash, a dash, a dot or an underscore, between words, or where a
// camel-cased word turns); a board that can grow widens, within its limit;
// and only past all of those do the letters shrink further. No name is ever
// cut off.

/** The lettered part of a board, in the atlas's pixels. */
export interface Board {
  readonly width: number;
  readonly height: number;
  /** The largest letters the board takes, and the smallest before a name breaks or the board widens, px. */
  readonly size: number;
  readonly least: number;
  /** Whether a name may break onto a second line. */
  readonly twoLines: boolean;
  /** How much wider the board may grow, as a factor; 1 for a board that cannot. */
  readonly widen: number;
}

export interface Lettered {
  readonly lines: readonly string[];
  /** The letters' size, px. */
  readonly size: number;
  /** How much wider the board stands than its own width: 1, up to its `widen`. */
  readonly widen: number;
}

/** Two lines of letters take this share of the board's height each. */
const TWO_LINE_SHARE = 0.42;

/** Every way to break `text` onto two lines: after a separator (a space is dropped), or where a camel-cased word turns. */
function breaksOf(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 1; i < text.length; i++) {
    const before = text[i - 1] as string;
    const at = text[i] as string;
    if (before === " ") out.push([text.slice(0, i - 1), text.slice(i)]);
    else if ("/-_.".includes(before) && at !== " ") out.push([text.slice(0, i), text.slice(i)]);
    else if (/[a-z0-9]/.test(before) && /[A-Z]/.test(at)) out.push([text.slice(0, i), text.slice(i)]);
  }
  return out.filter(([a, b]) => a.trim() !== "" && b.trim() !== "");
}

/**
 * Lays `text` out on `board`. `measure(text, size)` is its width at `size`
 * px; the result's every line measures no wider than the board's width times
 * its `widen`.
 */
export function letter(text: string, board: Board, measure: (text: string, size: number) => number): Lettered {
  const ref = board.size;
  /** Width per pixel of size, from one measurement at the board's own size. */
  const per = (s: string): number => Math.max(1e-6, measure(s, ref) / ref);
  const layouts = [{ lines: [text], per: per(text), cap: board.size }];
  if (board.twoLines) {
    const cap = Math.min(board.size, board.height * TWO_LINE_SHARE);
    for (const [a, b] of breaksOf(text)) layouts.push({ lines: [a, b], per: Math.max(per(a), per(b)), cap });
  }
  const sizeAt = (l: (typeof layouts)[number], widen: number): number => Math.min(l.cap, (board.width * widen) / l.per);
  // One line if it reaches the least size; else the best break; else the board widens as little as it must.
  const one = layouts[0] as (typeof layouts)[number];
  let chosen = one;
  let widen = 1;
  if (sizeAt(one, 1) < board.least) {
    const best = layouts.slice(1).sort((a, b) => sizeAt(b, 1) - sizeAt(a, 1))[0];
    if (best !== undefined && sizeAt(best, 1) >= board.least) chosen = best;
    else {
      const need = layouts.map((l) => ({ l, f: (board.least * l.per) / board.width })).sort((a, b) => a.f - b.f)[0] as { l: (typeof layouts)[number]; f: number };
      if (need.f <= board.widen) {
        chosen = need.l;
        widen = need.f;
      } else {
        widen = board.widen;
        chosen = layouts.slice().sort((a, b) => sizeAt(b, widen) - sizeAt(a, widen))[0] as (typeof layouts)[number];
      }
    }
  }
  let size = sizeAt(chosen, widen);
  // Text does not always scale exactly with its size: measure at the size chosen and shrink until every line fits.
  for (let k = 0; k < 4; k++) {
    const widest = Math.max(...chosen.lines.map((l) => measure(l, size)));
    if (widest <= board.width * widen) break;
    size *= ((board.width * widen) / widest) * 0.995;
  }
  return { lines: chosen.lines, size, widen };
}
