// Gaia's own mark: a hand-drawn "gaia" in moss green and ink, with a two-leaf
// sprout growing from the i, and the sprout alone on a round of paper for the
// window's icon. The SVG files are the source; this hands them to the page.

import LOGO from "./gaia-logo.svg?raw";
import MARK from "./gaia-mark.svg?raw";

/** The wordmark's markup, to inline wherever the app introduces itself. */
export const LOGO_SVG: string = LOGO.trim();

/** The wordmark's width over its height, from its viewBox. */
export const LOGO_ASPECT = ((): number => {
  const box = /viewBox="([^"]+)"/.exec(LOGO)?.[1]?.split(/\s+/).map(Number);
  return box === undefined || box.length < 4 ? 1.7 : (box[2] as number) / (box[3] as number);
})();

const dataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;

/** The wordmark as an image, for drawing onto a canvas such as the field map's; it is ready once it loads. */
export function logoImage(): HTMLImageElement {
  const img = new Image();
  img.src = dataUrl(LOGO);
  return img;
}

/** Sets the page's icon to the sprout. */
export function setFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = dataUrl(MARK);
  document.head.append(link);
}
