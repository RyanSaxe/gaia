// Gaia's mark (docs/design-system.md, "Gaia's mark"): a G cut through a dark green page onto Gaia's own world, the
// village at 17:30 as the renderer draws it, and beside it the name in lowercase with its ai in the meadow's green.
// The view is a picture of the world, kept as it was taken so the mark stays the same when the world is laid out
// again; the letters are Fraunces (OFL.txt), a heavy soft cut for the G and a lighter one for the name.
// `pnpm brand` (tools/brand.ts) paints it into the pictures the app shows, at the sizes it shows them.

import G_FACE from "./fraunces-g.woff2";
import NAME_FACE from "./fraunces-name.woff2";
import VIEW from "./view.webp";
import { layGround } from "../immersive/wild-ink.ts";
import { MAP_STYLE } from "../immersive/map-styles.ts";

type Ctx = CanvasRenderingContext2D;

const G_FAMILY = "Gaia G";
const NAME_FAMILY = "Gaia name";
/** The page around the G, lighter at its head. */
const PAGE = ["#27342c", "#18211b"] as const;
/** The shade the page's cut edge casts into the window. */
const EDGE_SHADE = "rgba(7, 10, 8, 0.8)";
/** The name's ink and its ai's green, on paper and on dark. */
const NAME_INK = { paper: { ink: "#2b2721", ai: "#557d4c" }, dark: { ink: "#f3ecdc", ai: "#a7c98f" } } as const;

/**
 * Where the icon's parts sit on its square, as fractions of its side: the G's size and baseline, and the view's
 * placement. The view was taken in the lab at 17:30, standing at (126, -465) and looking along yaw 124.3° and 4° up,
 * with the overlays hidden; it is placed so the autumn tree stands in the G's left stroke and the stone tower in its
 * top end.
 */
const G = { size: 1.044, baseline: 0.849 } as const;
const VIEW_AT = { x: -0.134, y: -0.348, side: 1.578 } as const;

let view: HTMLImageElement | null = null;

/** Loads the mark's two faces and its view; paint nothing until it resolves. */
export async function brandReady(): Promise<void> {
  const faces = [new FontFace(G_FAMILY, `url(${G_FACE})`), new FontFace(NAME_FAMILY, `url(${NAME_FACE})`)];
  for (const face of await Promise.all(faces.map((f) => f.load()))) document.fonts.add(face);
  const image = new Image();
  image.src = VIEW;
  await image.decode();
  view = image;
}

const canvasOf = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d") as Ctx];
};

/**
 * The icon's art, `size` pixels square: the dark page with the G cut through it onto the view. The cut edge shades the
 * window's top and left as a page's thickness would; `small` icons (32 px and under) shade it less, so the G stays bright.
 */
export function paintIcon(size: number, small: boolean): HTMLCanvasElement {
  if (view === null) throw new Error("paintIcon: call brandReady() first.");
  const [c, g] = canvasOf(size, size);
  const page = g.createLinearGradient(0, 0, 0, size);
  page.addColorStop(0, PAGE[0]);
  page.addColorStop(1, PAGE[1]);
  g.fillStyle = page;
  g.fillRect(0, 0, size, size);

  const letterG = (target: Ctx): void => {
    target.font = `${size * G.size}px "${G_FAMILY}"`;
    target.textAlign = "center";
    target.textBaseline = "alphabetic";
    target.fillText("G", size / 2, size * G.baseline);
  };
  // The window: the view, kept only inside the G.
  const [w, wg] = canvasOf(size, size);
  wg.drawImage(view, size * VIEW_AT.x, size * VIEW_AT.y, size * VIEW_AT.side, size * VIEW_AT.side);
  wg.globalCompositeOperation = "destination-in";
  letterG(wg);
  // The page's cut edge: the page with the G cut out casts its shade into the window, and only there.
  const [edge, eg] = canvasOf(size, size);
  eg.fillStyle = PAGE[1];
  eg.fillRect(0, 0, size, size);
  eg.globalCompositeOperation = "destination-out";
  letterG(eg);
  const k = size / 824;
  wg.globalCompositeOperation = "source-atop";
  wg.shadowColor = EDGE_SHADE;
  wg.shadowBlur = 16 * k * (small ? 0.5 : 1);
  wg.shadowOffsetX = 6 * k * (small ? 0.5 : 1);
  wg.shadowOffsetY = 10 * k * (small ? 0.5 : 1);
  wg.globalAlpha = small ? 0.6 : 1;
  wg.drawImage(edge, 0, 0);
  g.drawImage(w, 0, 0);
  return c;
}

/** The icon's art on the rounded square every macOS icon has, `side` pixels across, ready to set beside the name. */
function tile(side: number): HTMLCanvasElement {
  const [c, g] = canvasOf(side, side);
  g.beginPath();
  g.roundRect(0, 0, side, side, side * 0.225);
  g.clip();
  g.drawImage(paintIcon(Math.round(side), side <= 64), 0, 0, side, side);
  return c;
}

/** Writes "gaia" from its baseline's left end, its ai in green. */
function writeName(g: Ctx, x: number, baseline: number, px: number, ground: keyof typeof NAME_INK): number {
  g.font = `${px}px "${NAME_FAMILY}"`;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const parts = [
    ["g", NAME_INK[ground].ink],
    ["ai", NAME_INK[ground].ai],
    ["a", NAME_INK[ground].ink],
  ] as const;
  // Each part starts where the whole word so far ends, so the pairs keep the face's own spacing.
  let word = "";
  for (const [text, color] of parts) {
    g.fillStyle = color;
    g.fillText(text, x + g.measureText(word).width, baseline);
    word += text;
  }
  return g.measureText(word).width;
}

/**
 * The name alone, `width` pixels wide and cut to its ink, on clear ground: what the start's sheet and the slip print
 * into their paper, where the icon, a thing from outside the world, has no place.
 */
export function paintName(width: number): HTMLCanvasElement {
  const [, probe] = canvasOf(1, 1);
  probe.font = `100px "${NAME_FAMILY}"`;
  const ink = probe.measureText("gaia");
  const em = ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight;
  const px = (100 * width) / em;
  const k = px / 100;
  const [c, g] = canvasOf(width, (ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent) * k);
  writeName(g, ink.actualBoundingBoxLeft * k, ink.actualBoundingBoxAscent * k, px, "paper");
  return c;
}

/** The lockup's proportions, as fractions of the icon's side. */
const LOCKUP = { gap: 0.2, name: 0.86, baseline: 0.71 } as const;

/**
 * The icon beside the name, `width` pixels wide, on clear ground so it prints on any paper, or on its own sheet of the
 * map's paper, torn by `torn` (the sheet's torn edge, `DECKLE_MASK`, loaded).
 */
export function paintLockup(width: number, torn?: HTMLImageElement): HTMLCanvasElement {
  // Measure the name at the icon's side of 1, then size everything to the width asked for.
  const [, probe] = canvasOf(1, 1);
  probe.font = `100px "${NAME_FAMILY}"`;
  const nameWidth = (probe.measureText("gaia").width / 100) * LOCKUP.name;
  const onPaper = torn !== undefined;
  const pad = onPaper ? 0.5 : 0;
  const side = width / (1 + LOCKUP.gap + nameWidth + pad * 2);
  const [c, g] = canvasOf(width, side * (1 + pad * 2));
  if (onPaper) layGround(g, MAP_STYLE, c.width / 2, c.height / 2, (width / 400) * 0.62, c.width, c.height);
  const [x0, y0] = [side * pad, side * pad];
  g.drawImage(tile(side), x0, y0);
  writeName(g, x0 + side * (1 + LOCKUP.gap), y0 + side * LOCKUP.baseline, side * LOCKUP.name, "paper");
  if (!onPaper) return c;
  g.globalCompositeOperation = "destination-in";
  g.drawImage(torn, 0, 0, c.width, c.height);
  return c;
}
