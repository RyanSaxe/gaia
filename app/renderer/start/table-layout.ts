// Positions everything on the map table, in metres. Sheet coordinates have x
// to the right and y toward the person from the sheet's far left corner, and
// table coordinates are the world's, with x to the right and z toward the
// person from the table's center. On a desktop the sheet lies landscape, and on
// a phone it is portrait on a deeper table with the quill at its bottom.

/** A card: its center on the sheet, its side length, and the width its name may use beneath it. */
export interface CardPlace {
  readonly x: number;
  readonly y: number;
  readonly side: number;
  readonly nameWidth: number;
}

export interface TableLayout {
  readonly phone: boolean;
  /** The table top's width and depth. */
  readonly table: { readonly w: number; readonly d: number };
  /** The sheet's width and depth, its center on the table, and its rotation in radians. */
  readonly sheet: { readonly w: number; readonly h: number; readonly x: number; readonly z: number; readonly turn: number };
  /** Gaia's logo: its far left corner and width on the sheet. */
  readonly logo: { readonly x: number; readonly y: number; readonly w: number };
  /** The heading "the worlds you have walked": the position of its first letter, and its size. */
  readonly say: { readonly x: number; readonly y: number; readonly size: number };
  readonly cards: readonly CardPlace[];
  /** The text size of a world's name beneath its card. */
  readonly name: number;
  /** The line an address is written on: its y on the sheet, its ends, and the size of the text around it. */
  readonly line: { readonly y: number; readonly x0: number; readonly x1: number; readonly size: number };
  /** The quill's nib and the tip of its vane on the sheet. The tip may lie past the sheet's edge. */
  readonly quill: { readonly nib: readonly [number, number]; readonly tip: readonly [number, number] };
  /** The inkwell and the lantern, on the table. */
  readonly inkwell: readonly [number, number];
  readonly lantern: readonly [number, number];
}

/** The region of the sheet for the cards and their names: left, top, right, bottom. */
type Band = readonly [number, number, number, number];

/** The gap between two cards as a share of a card's side, and the gap between two rows in metres. */
const GAP = 0.25;
const ROW_GAP = 0.02;
/** The height reserved for a card's name beneath it, as a multiple of the name's text size: the spacing, then up to two lines. */
export const NAME_ROOM = 3.9;

/**
 * Places the cards for `n` worlds in `band`, using the column count that
 * gives the largest side, capped at `most`. Each row is centred, and the block
 * sits a third of the way down the band's free space, so the line below keeps
 * its room. Between equal sides, fewer columns win.
 */
export function cardsIn(n: number, band: Band, most: number, name: number): CardPlace[] {
  if (n === 0) return [];
  const [x0, y0, x1, y1] = band;
  const nameRoom = name * NAME_ROOM;
  let best = { cols: 1, rows: n, side: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const side = Math.min(most, (x1 - x0) / (cols + GAP * (cols - 1)), (y1 - y0 - rows * nameRoom - (rows - 1) * ROW_GAP) / rows);
    if (side > best.side + 1e-3) best = { cols, rows, side };
  }
  const { cols, rows, side } = best;
  const step = side * (1 + GAP);
  const rowStep = side + nameRoom + ROW_GAP;
  const top = y0 + (y1 - y0 - (rows * rowStep - ROW_GAP)) / 3;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const left = (x0 + x1) / 2 - ((inRow - 1) * step) / 2;
    return { x: left + (i - row * cols) * step, y: top + row * rowStep + side / 2, side, nameWidth: step * 0.9 };
  });
}

/** Whether a quill from `nib` to `tip`, with its vane about 3 cm to either side, comes within 3 cm of a box on the sheet. */
export function crosses(nib: readonly [number, number], tip: readonly [number, number], box: Band): boolean {
  for (let t = 0; t <= 1; t += 0.02) {
    const x = nib[0] + (tip[0] - nib[0]) * t;
    const y = nib[1] + (tip[1] - nib[1]) * t;
    if (x > box[0] - 0.03 && x < box[2] + 0.03 && y > box[1] - 0.03 && y < box[3] + 0.03) return true;
  }
  return false;
}

/** Lays out the table for `n` recent worlds, on a desktop or a phone. */
export function tableLayout(phone: boolean, n: number): TableLayout {
  if (!phone) {
    const sheet = { w: 1.12, h: 0.74, x: -0.03, z: 0.03, turn: -0.009 };
    const name = n <= 4 ? 0.02 : 0.017;
    const line = n === 0 ? { y: 0.43, x0: 0.3, x1: 0.82, size: 0.022 } : { y: 0.615, x0: 0.34, x1: 0.78, size: 0.0175 };
    const cards = cardsIn(n, [0.09, 0.19, sheet.w - 0.09, line.y - line.size * 3.9], 0.28, name);
    // The quill rests by the line with its vane rising toward the far right corner. Its tip starts 17 cm above the line
    // and moves down until the quill clears every card and name.
    const nib = [0.81, line.y + 0.012] as const;
    let tipY = line.y - 0.17;
    while (tipY < nib[1] - 0.05 && cards.some((c) => crosses(nib, [1.02, tipY], [c.x - c.side / 2, c.y - c.side / 2, c.x + c.side / 2, c.y + c.side / 2 + name * NAME_ROOM]))) tipY += 0.01;
    return {
      phone,
      table: { w: 1.85, d: 1.4 },
      sheet,
      logo: { x: 0.05, y: 0.04, w: 0.16 },
      say: { x: 0.058, y: 0.178, size: 0.019 },
      cards,
      name,
      line,
      quill: { nib, tip: [1.02, tipY] },
      inkwell: [0.63, 0.19],
      lantern: [0.66, -0.2],
    };
  }
  const sheet = { w: 0.58, h: 0.96, x: 0, z: 0.06, turn: 0.006 };
  const name = n <= 2 ? 0.026 : 0.022;
  const line = n === 0 ? { y: 0.5, x0: 0.07, x1: 0.51, size: 0.029 } : { y: 0.735, x0: 0.07, x1: 0.51, size: 0.025 };
  return {
    phone,
    table: { w: 1.35, d: 1.6 },
    sheet,
    logo: { x: 0.04, y: 0.035, w: 0.19 },
    say: { x: 0.048, y: 0.205, size: 0.025 },
    cards: cardsIn(n, [0.04, 0.23, sheet.w - 0.04, line.y - line.size * 3.6], 0.3, name),
    name,
    line,
    quill: { nib: [0.15, 0.93], tip: [0.5, 0.912] },
    inkwell: [-0.21, -0.5],
    lantern: [0.21, -0.5],
  };
}
