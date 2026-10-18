// The journal's titles in Gaia's own face: the title page's name and each page's heading are lettered in the name's
// cut of Fraunces (Fraunces at 600, `app/renderer/brand/fraunces-name.woff2`, under its OFL), so the book speaks in
// the mark's voice. Body text stays in the journal's serif.

import NAME_FACE from "../brand/fraunces-name.woff2";

/** The family the journal's titles are lettered in, with the journal's serif behind it until the face has loaded. */
export const TITLE_FAMILY = `"Gaia title", Georgia, "Times New Roman", serif`;

/** Starts loading the face as the journal is made, so it is in long before the book first opens. */
export function loadTitleFace(): void {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const face = new FontFace("Gaia title", `url(${NAME_FACE})`, { weight: "600" });
  document.fonts.add(face);
  void face.load();
}
