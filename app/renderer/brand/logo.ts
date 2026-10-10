// Gaia's mark. Where it is shown large, at the head of the start's sheet and
// of the slip, it is the reviewer's logo: "gaia" in mossy, cracked stone
// letters, a picture rather than shapes, so it comes at the sizes it is
// shown at on a 2x screen and no larger. Wherever it is drawn small, as the
// window's icon, it is the flat round mark (`mark.svg`), which stays sharp
// at 16 px where the logo's stone and moss would blur.

import LOGO_264 from "./logo-264.webp";
import LOGO_640 from "./logo-640.webp";
import MARK from "./mark.svg?raw";

/** The logo for the slip, 132 px wide. */
export const SLIP_LOGO = LOGO_264;
/** The logo for the start's sheet, up to 320 px wide. */
export const SHEET_LOGO = LOGO_640;
/** The logo's width over its height. */
export const LOGO_ASPECT = 1817 / 841;

const dataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;

/** Sets the page's icon to the mark. */
export function setFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = dataUrl(MARK);
  document.head.append(link);
}
