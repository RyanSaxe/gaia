// Exports Gaia's mark (docs/design-system.md, "Gaia's mark"): the lowercase name with "ai" in green, printed on the start
// page's sheet and the slip, and the icon, a G cut through a dark green page onto Gaia's world, used only outside the
// world (`paint.ts`). `pnpm brand` paints these images at their displayed sizes for a 2x screen, along with the macOS
// app icon (app/build/icon.icns).

import FAVICON from "./favicon.webp";
import LOGO_SHEET from "./logo-sheet.webp";
import LOGO_SLIP from "./logo-slip.webp";

/** The name image the slip shows, 104 px wide. */
export const SLIP_LOGO = LOGO_SLIP;
/** The name image on the start page's sheet, up to 260 px wide. */
export const SHEET_LOGO = LOGO_SHEET;
/** The mark's width over its height, as `pnpm brand` paints it. */
export const LOGO_ASPECT = 520 / 288;

/** Sets the page's favicon to the mark's icon. */
export function setFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/webp";
  link.href = FAVICON;
  document.head.append(link);
}
