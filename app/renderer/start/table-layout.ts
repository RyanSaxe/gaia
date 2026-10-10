// Where everything lies on the map table, in metres. The sheet's own frame
// has x to the right and y toward the person from its far left corner; the
// table's frame is the world's, x to the right and z toward the person, with
// the table's middle at the origin. On a desktop the sheet lies wide across
// the table; on a phone it stands upright on a deeper table with the quill
// at its foot. The worlds walked before lie in rows between the words at the
// top and the line at the foot, as large as the room allows, so one world
// takes a card of 28 cm and six still read.

/** A card: its middle on the sheet, its side, and the width its name may take beneath it. */
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
  /** The sheet's width and depth, where its middle lies on the table, and how far it is turned (radians). */
  readonly sheet: { readonly w: number; readonly h: number; readonly x: number; readonly z: number; readonly turn: number };
  /** Gaia's logo: its far left corner and width, on the sheet. */
  readonly logo: { readonly x: number; readonly y: number; readonly w: number };
  /** "the worlds you have walked": where its first letter stands, and its size. */
  readonly say: { readonly x: number; readonly y: number; readonly size: number };
  readonly cards: readonly CardPlace[];
  /** The lettering of a world's name beneath its card. */
  readonly name: number;
  /** The line an address is written on: its height on the sheet, its ends, and the size of the words about it. */
  readonly line: { readonly y: number; readonly x0: number; readonly x1: number; readonly size: number };
  /** The quill's nib and the tip of its vane, on the sheet (the tip may lie past its edge). */
  readonly quill: { readonly nib: readonly [number, number]; readonly tip: readonly [number, number] };
  /** The inkwell and the lantern, on the table. */
  readonly inkwell: readonly [number, number];
  readonly lantern: readonly [number, number];
}

/** The room the cards and their names lie in, on the sheet: left, top, right, bottom. */
type Band = readonly [number, number, number, number];

/** The gap between two cards, as a share of a card's side, and between two rows. */
const GAP = 0.25;
const ROW_GAP = 0.02;
/** The height a card's name takes beneath it, as a multiple of the name's size: where it lies, then its name on up to two lines. */
export const NAME_ROOM = 3.9;

/**
 * The cards for `n` worlds in `band`: in as many columns as gives them the
 * largest side, at most `most`, the rows centred, and the whole block nearer
 * the top of the band than its foot, so the line below keeps its room. With
 * equal sides, fewer rows win.
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

/** Whether a quill from `nib` to `tip`, its vane about 3 cm either side, comes within reach of a box on the sheet. */
export function crosses(nib: readonly [number, number], tip: readonly [number, number], box: Band): boolean {
  for (let t = 0; t <= 1; t += 0.02) {
    const x = nib[0] + (tip[0] - nib[0]) * t;
    const y = nib[1] + (tip[1] - nib[1]) * t;
    if (x > box[0] - 0.03 && x < box[2] + 0.03 && y > box[1] - 0.03 && y < box[3] + 0.03) return true;
  }
  return false;
}

/** Everything on the table for `n` worlds walked, on a desktop or a phone. */
export function tableLayout(phone: boolean, n: number): TableLayout {
  if (!phone) {
    const sheet = { w: 1.12, h: 0.74, x: -0.03, z: 0.03, turn: -0.009 };
    const name = n <= 4 ? 0.02 : 0.017;
    const line = n === 0 ? { y: 0.43, x0: 0.3, x1: 0.82, size: 0.022 } : { y: 0.615, x0: 0.34, x1: 0.78, size: 0.0175 };
    const cards = cardsIn(n, [0.09, 0.19, sheet.w - 0.09, line.y - line.size * 3.9], 0.28, name);
    // The quill rests by the line, its vane rising toward the far right corner, but no higher than clears every card and its name.
    const nib = [0.81, line.y + 0.012] as const;
    let tipY = line.y - 0.17;
    while (tipY < nib[1] - 0.05 && cards.some((c) => crosses(nib, [1.02, tipY], [c.x - c.side / 2, c.y - c.side / 2, c.x + c.side / 2, c.y + c.side / 2 + name * NAME_ROOM]))) tipY += 0.01;
    return {
      phone,
      table: { w: 1.85, d: 1.4 },
      sheet,
      logo: { x: 0.05, y: 0.04, w: 0.235 },
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
    logo: { x: 0.04, y: 0.035, w: 0.3 },
    say: { x: 0.048, y: 0.205, size: 0.025 },
    cards: cardsIn(n, [0.04, 0.23, sheet.w - 0.04, line.y - line.size * 3.6], 0.3, name),
    name,
    line,
    quill: { nib: [0.15, 0.93], tip: [0.5, 0.912] },
    inkwell: [-0.21, -0.5],
    lantern: [0.21, -0.5],
  };
}
