// Gaia's mark (docs/design-system.md, "Gaia's mark"): its name lettered across its own land, as the field map letters
// an area, painted by the map's own hand (`paint.ts`); and as the icon, the land's rounded square with the G on it.
// They are pictures at the sizes they are shown on a 2x screen, painted by `pnpm brand`, which paints them again
// whenever the map's look changes. The app's icon for macOS is painted with them (app/build/icon.icns).

import FAVICON from "./favicon.webp";
import LOGO_SHEET from "./logo-sheet.webp";
import LOGO_SLIP from "./logo-slip.webp";

/** The mark for the slip, 132 px wide. */
export const SLIP_LOGO = LOGO_SLIP;
/** The mark for the start's sheet, up to 320 px wide. */
export const SHEET_LOGO = LOGO_SHEET;
/** The mark's width over its height, as `pnpm brand` paints it. */
export const LOGO_ASPECT = 641 / 315;

/** Sets the page's icon to the mark's. */
export function setFavicon(): void {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/webp";
  link.href = FAVICON;
  document.head.append(link);
}
