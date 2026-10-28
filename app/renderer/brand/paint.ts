// Paints Gaia's mark (docs/design-system.md, "Gaia's mark"): a G cut through a dark green page onto a rendered view of
// Gaia's village at 17:30, beside the lowercase name with "ai" in the meadow's green. The view is a stored image, so
// the mark does not change when the world's layout changes. The letters are Fraunces (OFL.txt), a heavy soft cut for
// the G and a lighter one for the name, and `pnpm brand` (tools/brand.ts) paints the app's images at their displayed
// sizes.

import G_FACE from "./fraunces-g.woff2";
import NAME_FACE from "./fraunces-name.woff2";
import VIEW from "./view.webp";
import { layGround } from "../immersive/wild-ink.ts";
import { MAP_STYLE } from "../immersive/map-styles.ts";

type Ctx = CanvasRenderingContext2D;

const G_FAMILY = "Gaia G";
const NAME_FAMILY = "Gaia name";
/** The page's gradient around the G, lighter at the top. */
const PAGE = ["#27342c", "#18211b"] as const;
/** The shadow the page's cut edge casts into the G-shaped window onto the view. */
const EDGE_SHADE = "rgba(7, 10, 8, 0.8)";
/** The name's ink and its "ai" green, for paper and dark backgrounds. */
const NAME_INK = { paper: { ink: "#2b2721", ai: "#557d4c" }, dark: { ink: "#f3ecdc", ai: "#a7c98f" } } as const;

/**
 * Positions on the icon's square, as fractions of its side: the G's size and baseline, and the view's placement. The
 * view was captured in the lab at 17:30 from (126, -465), at yaw 124.3° and pitch 4° up, with the overlays hidden. It
 * is placed so the autumn tree falls in the G's left stroke and the stone tower in its top end.
 */
const G = { size: 1.044, baseline: 0.849 } as const;
const VIEW_AT = { x: -0.134, y: -0.348, side: 1.578 } as const;

let view: HTMLImageElement | null = null;

/** Loads the mark's two font faces and its view. Paint nothing until it resolves. */
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
 * Paints the icon, `size` pixels square: the dark page with the G cut through it onto the view. The cut edge shades the
 * window's top and left as a page's thickness would. Callers pass `small` for icons shown at 32 px and under, which
 * shade it less so the G stays bright.
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
  // The window: the view, clipped to the G.
  const [w, wg] = canvasOf(size, size);
  wg.drawImage(view, size * VIEW_AT.x, size * VIEW_AT.y, size * VIEW_AT.side, size * VIEW_AT.side);
  wg.globalCompositeOperation = "destination-in";
  letterG(wg);
  // The page's cut edge: the page with the G cut out casts its shadow into the window, and only there.
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

/** The icon on a macOS icon's rounded square, `side` pixels across, for placing beside the name. */
function tile(side: number): HTMLCanvasElement {
  const [c, g] = canvasOf(side, side);
  g.beginPath();
  g.roundRect(0, 0, side, side, side * 0.225);
  g.clip();
  g.drawImage(paintIcon(Math.round(side), side <= 64), 0, 0, side, side);
  return c;
}

/** Writes "gaia" from the left end of its baseline, with "ai" in green, and returns the word's width. */
function writeName(g: Ctx, x: number, baseline: number, px: number, ground: keyof typeof NAME_INK): number {
  g.font = `${px}px "${NAME_FAMILY}"`;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const parts = [
    ["g", NAME_INK[ground].ink],
    ["ai", NAME_INK[ground].ai],
    ["a", NAME_INK[ground].ink],
  ] as const;
  // Each part starts at the measured width of the word so far, so the letters keep the font's own spacing.
  let word = "";
  for (const [text, color] of parts) {
    g.fillStyle = color;
    g.fillText(text, x + g.measureText(word).width, baseline);
    word += text;
  }
  return g.measureText(word).width;
}

/**
 * Paints the name alone, `width` pixels wide, cropped to its ink on a transparent background. The start page's sheet
 * and the slip print it on their paper, because the icon belongs outside the world.
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
 * Paints the icon beside the name, `width` pixels wide, on a transparent background for any paper, or on its own sheet
 * of map paper with the torn edge `torn` (a loaded `DECKLE_MASK`).
 */
export function paintLockup(width: number, torn?: HTMLImageElement): HTMLCanvasElement {
  // Measures the name for an icon side of 1, then scales everything to `width`.
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
