// Gaia's mark (docs/design-system.md, "Gaia's mark"): its name in lowercase with the ai in green, which the start's
// sheet and the slip print into their paper, and its icon, a G cut through a dark green page onto Gaia's own world,
// which stays outside the world (`paint.ts`). They are pictures at the sizes they are shown on a 2x screen, painted by
// `pnpm brand`, which also paints the app's icon for macOS (app/build/icon.icns).

import FAVICON from "./favicon.webp";
import LOGO_SHEET from "./logo-sheet.webp";
import LOGO_SLIP from "./logo-slip.webp";

/** The name the slip prints, 104 px wide. */
export const SLIP_LOGO = LOGO_SLIP;
/** The name the start's sheet prints, up to 260 px wide. */
export const SHEET_LOGO = LOGO_SHEET;
/** The mark's width over its height, as `pnpm brand` paints it. */
export const LOGO_ASPECT = 520 / 288;

/** Sets the page's icon to the mark's. */
export function setFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/webp";
  link.href = FAVICON;
  document.head.append(link);
}
