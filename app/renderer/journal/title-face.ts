// Loads the face for the journal's titles. The title page's name and each page's heading use the logo's cut of
// Fraunces at weight 600 (`app/renderer/brand/fraunces-name.woff2`, under its OFL), to match Gaia's logo. Body text
// stays in the journal's serif.

import NAME_FACE from "../brand/fraunces-name.woff2";

/** The font family for the journal's titles, with the journal's serif as fallback until the face loads. */
export const TITLE_FAMILY = `"Gaia title", Georgia, "Times New Roman", serif`;

/** Starts loading the face when the journal is created, so it is ready before the book first opens. */
export function loadTitleFace(): void {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const face = new FontFace("Gaia title", `url(${NAME_FACE})`, { weight: "600" });
  document.fonts.add(face);
  void face.load();
}
