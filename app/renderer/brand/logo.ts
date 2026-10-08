// Gaia's own mark: a wordmark, and a mark alone for the window's icon. The
// SVG files are the source; this hands them to the page. Every file is plain
// paths: no filters, gradients or IDs, so it can be inlined any number of
// times.

import LOGO from "./logo.svg?raw";
import MARK from "./mark.svg?raw";

/** The wordmark's markup, to inline wherever the app introduces itself. */
export const LOGO_SVG: string = LOGO.trim();

const dataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;

/** Sets the page's icon to the mark. */
export function setFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = dataUrl(MARK);
  document.head.append(link);
}
