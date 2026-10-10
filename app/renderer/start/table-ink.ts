// What is drawn on the map table's paper rather than made in its shader:
// Gaia's logo and the words in ink on the sheet, the line an address is
// written on, and a quill's vane. Each is a canvas painted once, at the size
// the screen shows it; only the line's small strip is painted again as the
// address is written.

import type { StartOffer } from "../../world-service/protocol.ts";
import type { TableLayout } from "./table-layout.ts";

const SERIF = '"Iowan Old Style", Georgia, "Times New Roman", serif';
const INK = "rgba(46,34,22,0.92)";
const INK_SOFT = "rgba(104,86,62,0.95)";
/** The red-brown of an answer that an address leads nowhere. */
const INK_ANSWER = "rgba(120,60,36,0.92)";

/** What is written on the line: the address, how far the darker stroke has run while it is asked after, and why it led nowhere. */
export interface Writing {
  readonly typed: string;
  /** 0 to 1: the darker stroke of ink along the line while the address is asked after. */
  readonly reading: number;
  readonly answer: string;
  /** 0 to 1: the answer being written in. */
  readonly answered: number;
}

/** A box on the sheet, metres: left, top, right, bottom. */
export type SheetBox = readonly [number, number, number, number];

/** A repeatable 0..1 from a seed: mulberry32. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D noise in about -1..1. */
function noise1(seed: number): (x: number) => number {
  const r = seeded(seed);
  const table = Array.from({ length: 256 }, () => r() * 2 - 1);
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[((i % 256) + 256) % 256] as number;
    const b = table[(((i + 1) % 256) + 256) % 256] as number;
    return a + (b - a) * f * f * (3 - 2 * f);
  };
}

const canvasOf = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
};

/** Lettering in the map's serif, with the faint spread ink has on rough paper. */
function letter(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "center", spacing = 0): void {
  g.save();
  g.font = font;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.letterSpacing = `${spacing}px`;
  g.fillStyle = color;
  g.globalAlpha = 0.18;
  for (const [dx, dy] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]] as const) g.fillText(text, x + dx, y + dy);
  g.globalAlpha = 1;
  g.fillText(text, x, y);
  g.restore();
}

/** A line drawn with a quill: it pools where the nib first touched and thins as the ink runs low, `upTo` of the way along. */
function inkLine(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, mm: number, seed: number, ink: string, upTo = 1): void {
  const wobble = noise1(seed);
  const steps = 220;
  const end = Math.max(0, Math.min(1, upTo));
  const at = (t: number): number => y + wobble(t * 6) * 0.9 * mm + wobble(t * 31 + 50) * 0.15 * mm;
  g.save();
  g.strokeStyle = g.fillStyle = ink;
  g.lineCap = "round";
  for (let i = 0; i < steps * end; i++) {
    const t = i / steps;
    g.lineWidth = (0.75 + 0.55 * Math.exp(-t * 18) - 0.25 * t + 0.08 * wobble(t * 40 + 90)) * mm;
    g.beginPath();
    g.moveTo(x0 + (x1 - x0) * t, at(t));
    g.lineTo(x0 + (x1 - x0) * (t + 1 / steps), at(t + 1 / steps));
    g.stroke();
  }
  if (end > 0) {
    g.beginPath();
    g.ellipse(x0 + 0.4 * mm, at(0), 1.1 * mm, 0.85 * mm, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

const baseName = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;
/** Where a world lies, in italic over its name: who keeps it on GitHub, or the folder it sits in. */
export const whereOf = (r: StartOffer["recent"][number]): string => (r.github !== undefined ? (r.github.split("/")[0] ?? "") : r.root.includes("/") ? baseName(r.root.slice(0, r.root.lastIndexOf("/"))) : "");
export const nameOf = (r: StartOffer["recent"][number]): string => (r.github !== undefined ? (r.github.split("/")[1] ?? r.name) : r.name);

/**
 * The sheet's ink, `pxPerM` pixels a metre: Gaia's logo at its head, what
 * the table offers, each world's name and where it lies beneath its card,
 * and the question over the line. Where there is no ink the canvas is clear,
 * so the paper shows through.
 */
export function paintSheetInk(l: TableLayout, recent: readonly StartOffer["recent"][number][], logo: HTMLImageElement, pxPerM: number): HTMLCanvasElement {
  const P = (m: number): number => m * pxPerM;
  const [c, g] = canvasOf(P(l.sheet.w), P(l.sheet.h));
  const lw = P(l.logo.w);
  g.drawImage(logo, P(l.logo.x), P(l.logo.y), lw, (lw * logo.naturalHeight) / logo.naturalWidth);
  const none = recent.length === 0;
  letter(g, none ? "where shall we wander?" : "the worlds you have walked", P(l.say.x), P(l.say.y), `italic ${P(l.say.size)}px ${SERIF}`, INK_SOFT, "left", P(0.0004));
  for (const [i, r] of recent.entries()) {
    const card = l.cards[i];
    if (card === undefined) break;
    const below = card.y + card.side / 2;
    const where = whereOf(r);
    if (where !== "") letter(g, where, P(card.x), P(below + l.name * 1.3), `italic ${fitted(g, where, `italic {}px ${SERIF}`, P(l.name * 0.72), P(card.nameWidth), 0)}px ${SERIF}`, INK_SOFT);
    const { lines, size } = nameLines(g, nameOf(r).toUpperCase(), P(l.name), P(card.nameWidth));
    lines.forEach((text, k) => letter(g, text, P(card.x), P(below + l.name * (where !== "" ? 2.55 : 1.75)) + k * size * 1.1, `600 ${size}px ${SERIF}`, INK, "center", size * 0.17));
  }
  const mid = (l.line.x0 + l.line.x1) / 2;
  letter(g, `${none ? "write" : "or write"} the address of a place on GitHub`, P(mid), P(l.line.y - l.line.size * 2.6), `italic ${P(l.line.size)}px ${SERIF}`, INK_SOFT);
  return c;
}

/** The largest size up to `size` at which `text` fits `width` in `font` (with "{}" for the size), its letters spaced by `spacing` ems; no smaller than `least` of it. */
function fitted(g: CanvasRenderingContext2D, text: string, font: string, size: number, width: number, spacing: number, least = 0.55): number {
  g.save();
  g.font = font.replace("{}", String(size));
  g.letterSpacing = `${size * spacing}px`;
  const w = g.measureText(text).width;
  g.restore();
  return w <= width ? size : Math.max(size * least, (size * width) / w);
}

/**
 * A world's name in the map's spaced capitals, fitted to `width`: on one
 * line, a little smaller if need be, or broken onto two at the mark nearest
 * its middle (a hyphen, a dot, a slash) when that keeps it larger, and its
 * end left off only when even two lines at half its size will not hold it.
 */
function nameLines(g: CanvasRenderingContext2D, name: string, size: number, width: number): { lines: string[]; size: number } {
  const font = `600 {}px ${SERIF}`;
  const one = fitted(g, name, font, size, width, 0.17, 0);
  if (one >= size * 0.8 || name.length < 6) return { lines: [name], size: Math.max(one, size * 0.5) };
  const marks = [...name.matchAll(/[-._/ ]/g)].map((m) => (m.index ?? 0) + 1).filter((k) => k > 1 && k < name.length - 1);
  const at = (marks.length > 0 ? marks : [Math.ceil(name.length / 2)]).reduce((b, k) => (Math.abs(k - name.length / 2) < Math.abs(b - name.length / 2) ? k : b));
  const lines = [name.slice(0, at).trim(), name.slice(at).trim()];
  const two = Math.min(...lines.map((t) => fitted(g, t, font, size, width, 0.17, 0)));
  if (two <= one) return { lines: [name], size: Math.max(one, size * 0.5) };
  // A hair under the exact fit, so measuring again never finds it a hair too wide.
  const shown = Math.max(two * 0.98, size * 0.5);
  return { lines: lines.map((t) => clipped(g, t, font.replace("{}", String(shown)), width, shown * 0.17)), size: shown };
}

/** `text` with its end left off, so it fits `width` in `font`. */
function clipped(g: CanvasRenderingContext2D, text: string, font: string, width: number, spacing: number): string {
  g.save();
  g.font = font;
  g.letterSpacing = `${spacing}px`;
  let shown = text;
  while (shown.length > 1 && g.measureText(shown).width > width) shown = shown.slice(0, -2) + "…";
  g.restore();
  return shown;
}

/** The strip of the sheet the line's writing takes: the line, the address on it, an answer beneath and the folder's words. */
export function writingBox(l: TableLayout): SheetBox {
  const mid = (l.line.x0 + l.line.x1) / 2;
  const half = (l.line.x1 - l.line.x0) / 2 + 0.11;
  return [Math.max(0.01, mid - half), l.line.y - l.line.size * 2, Math.min(l.sheet.w - 0.01, mid + half), Math.min(l.sheet.h - 0.005, l.line.y + l.line.size * 7)];
}

/**
 * Paints the line's strip onto `g` (`writingBox`, `pxPerM` pixels a metre):
 * the ink line, the address written on it or a pale "github.com/…" while it
 * is empty, a darker stroke running along it while the address is asked
 * after, an answer beneath in red-brown ink, and "or open a folder on this
 * computer" with a pencilled underline, moved down to make room for an
 * answer. Returns where the folder's words lie on the sheet.
 */
export function paintWriting(g: CanvasRenderingContext2D, l: TableLayout, w: Writing, pxPerM: number): SheetBox {
  const [bx, by, wx1] = writingBox(l);
  const wx0 = bx;
  const P = (m: number): number => m * pxPerM;
  const X = (m: number): number => P(m - bx);
  const Y = (m: number): number => P(m - by);
  const mm = pxPerM / 1000;
  const ln = l.line;
  const mid = (ln.x0 + ln.x1) / 2;
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  inkLine(g, X(ln.x0), X(ln.x1), Y(ln.y), mm, 5, "rgba(46,34,22,0.88)");
  if (w.typed === "") letter(g, "github.com/…", X(mid), Y(ln.y - ln.size * 0.55), `italic ${P(ln.size * 1.2)}px ${SERIF}`, "rgba(96,92,86,0.42)");
  else letter(g, fit(g, w.typed, `${P(ln.size * 1.2)}px ${SERIF}`, P(ln.x1 - ln.x0)), X(mid), Y(ln.y - ln.size * 0.55), `${P(ln.size * 1.2)}px ${SERIF}`, w.answer === "" ? "rgba(30,24,40,0.9)" : "rgba(30,24,40,0.62)");
  if (w.reading > 0) inkLine(g, X(ln.x0), X(ln.x1), Y(ln.y + 0.0006), mm * 1.5, 6, "rgba(30,22,14,0.95)", w.reading);
  const lines = w.answer === "" ? [] : wrap(g, w.answer, `italic ${P(ln.size * 0.95)}px ${SERIF}`, P(Math.min(ln.x1 - ln.x0 + 0.2, wx1 - wx0 - 0.02)));
  g.save();
  g.globalAlpha = w.answered;
  lines.forEach((text, i) => letter(g, text, X(mid), Y(ln.y + ln.size * (1.9 + i * 1.3)), `italic ${P(ln.size * 0.95)}px ${SERIF}`, INK_ANSWER));
  g.restore();
  const folderY = ln.y + ln.size * (lines.length === 0 ? 2.9 : 3 + lines.length * 1.3);
  const font = `${P(ln.size * 0.98)}px ${SERIF}`;
  const folder = "or open a folder on this computer";
  letter(g, folder, X(mid), Y(folderY), font, INK);
  g.save();
  g.font = font;
  const half = g.measureText(folder).width / pxPerM / 2;
  g.strokeStyle = "rgba(90,80,64,0.5)";
  g.setLineDash([P(0.0012), P(0.0016)]);
  g.lineWidth = P(0.0004);
  g.beginPath();
  g.moveTo(X(mid - half), Y(folderY + ln.size * 0.3));
  g.lineTo(X(mid + half), Y(folderY + ln.size * 0.3));
  g.stroke();
  g.restore();
  return [mid - half, folderY - ln.size * 1.1, mid + half, folderY + ln.size * 0.6];
}

/** `text` as written on the line: its end, if it runs past the line. */
function fit(g: CanvasRenderingContext2D, text: string, font: string, width: number): string {
  g.save();
  g.font = font;
  let shown = text;
  while (shown.length > 1 && g.measureText(shown).width > width) shown = shown.slice(1);
  g.restore();
  return shown === text ? text : `…${shown.slice(1)}`;
}

/** `text` broken into lines no wider than `width` in `font`. */
function wrap(g: CanvasRenderingContext2D, text: string, font: string, width: number): string[] {
  g.save();
  g.font = font;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const next = current === "" ? word : `${current} ${word}`;
    if (current !== "" && g.measureText(next).width > width) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  lines.push(current);
  g.restore();
  return lines;
}

/** A canvas for the line's strip at `pxPerM` pixels a metre. */
export function writingCanvas(l: TableLayout, pxPerM: number): HTMLCanvasElement {
  const [x0, y0, x1, y1] = writingBox(l);
  return canvasOf((x1 - x0) * pxPerM, (y1 - y0) * pxPerM)[0];
}

/**
 * A quill's vane unrolled: x along the shaft from its cut end, y across it,
 * the shaft at the middle. Barbs angle back from the shaft, pale with a
 * grey-brown band, split here and there as a used feather's are, with soft
 * down where the vane begins.
 */
export function paintFeather(w: number, h: number, seed: number): HTMLCanvasElement {
  const [c, g] = canvasOf(w, h);
  const r = seeded(seed);
  const n = noise1(seed + 4);
  const mid = h / 2;
  // Narrow where the vane begins, widest two thirds along, rounding to the tip; one side narrower than the other.
  const half = (t: number, side: number): number => {
    const body = Math.sin(Math.min(1, t / 0.92) * Math.PI * 0.62) * (1 - Math.pow(Math.max(0, t - 0.7) / 0.3, 2.2) * 0.85);
    return Math.max(0, body) * (h / 2 - 2) * (side > 0 ? 1 : 0.72);
  };
  g.lineCap = "round";
  const start = 0.22;
  const barbs = Math.round(w * 0.7);
  for (let i = 0; i < barbs; i++) {
    const t = start + (1 - start) * (i / barbs);
    for (const side of [-1, 1]) {
      const split = n(t * 22 + side * 5) > 0.62 ? 0.82 : 1;
      const len = half((t - start) / (1 - start), side) * split * (0.96 + r() * 0.06);
      if (len < 2) continue;
      const x = t * w;
      const tone = 0.5 + 0.5 * n(t * 7 + side * 2.3);
      const band = Math.exp(-Math.pow((t - 0.55) / 0.12, 2)) * 0.6 + (t > 0.9 ? 0.4 : 0);
      const L = 236 - band * 70 - tone * 18;
      g.strokeStyle = `rgba(${L + 6},${L},${L - 12},${0.55 + r() * 0.35})`;
      g.lineWidth = (0.9 + r() * 0.7) * (h / 256);
      g.beginPath();
      g.moveTo(x, mid);
      g.quadraticCurveTo(x + len * 0.155, mid + side * len * 0.55, x + len * 0.62, mid + side * len);
      g.stroke();
    }
  }
  for (let i = 0; i < 130; i++) {
    const t = start - 0.05 + r() * 0.12;
    const side = r() < 0.5 ? -1 : 1;
    const len = (0.15 + r() * 0.35) * h * 0.5;
    g.strokeStyle = `rgba(245,240,230,${0.25 + r() * 0.3})`;
    g.lineWidth = 0.8 * (h / 256);
    g.beginPath();
    g.moveTo(t * w, mid);
    g.bezierCurveTo(t * w + len * 0.2, mid + side * len * 0.3, t * w + len * (r() - 0.2), mid + side * len * 0.8, t * w + len * 0.5 * (r() - 0.3), mid + side * len);
    g.stroke();
  }
  return c;
}
