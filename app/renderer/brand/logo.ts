// Gaia's own mark, in one of several directions, each a wordmark and a mark
// alone for the window's icon. The SVG files are the source; this picks one
// and hands it to the page. Every file is plain paths: no filters, gradients
// or IDs, so it can be inlined any number of times.

import FIREFLY_LOGO from "./firefly/logo.svg?raw";
import FIREFLY_MARK from "./firefly/mark.svg?raw";
import GROVE_LOGO from "./grove/logo.svg?raw";
import GROVE_MARK from "./grove/mark.svg?raw";
import SEASONS_LOGO from "./seasons/logo.svg?raw";
import SEASONS_MARK from "./seasons/mark.svg?raw";
import SPROUT_LOGO from "./sprout/logo.svg?raw";
import SPROUT_MARK from "./sprout/mark.svg?raw";
import WATERCOLOR_LOGO from "./watercolor/logo.svg?raw";
import WATERCOLOR_MARK from "./watercolor/mark.svg?raw";

/**
 * The directions:
 * - `firefly`: "g" and the last "a" in moss green, the land; "ai" in the
 *   lantern's amber, the light Jev brings to it; the i's dot a firefly.
 * - `watercolor`: painted with a brush in moss-green watercolor, the field
 *   map's own medium; the mark a sprout inside an ensō.
 * - `seasons`: alive at the "g", weathered and taken back by ivy at the last
 *   "a"; `seasons/live.svg` shows one vitality for the whole word, read from
 *   `--gaia-v` on any parent.
 * - `grove`: a cartographer's ink line, and from the i a tree whose branches
 *   are a graph.
 * - `sprout`: round 12's moss-green word with a two-leaf sprout, after v1's.
 */
const OPTIONS = {
  firefly: { logo: FIREFLY_LOGO, mark: FIREFLY_MARK },
  watercolor: { logo: WATERCOLOR_LOGO, mark: WATERCOLOR_MARK },
  seasons: { logo: SEASONS_LOGO, mark: SEASONS_MARK },
  grove: { logo: GROVE_LOGO, mark: GROVE_MARK },
  sprout: { logo: SPROUT_LOGO, mark: SPROUT_MARK },
} as const;

/** The direction the app shows. */
const CHOSEN: keyof typeof OPTIONS = "firefly";

const LOGO = OPTIONS[CHOSEN].logo;
const MARK = OPTIONS[CHOSEN].mark;

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

/** Sets the page's icon to the mark. */
export function setFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = dataUrl(MARK);
  document.head.append(link);
}
