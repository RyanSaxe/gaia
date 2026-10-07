import { kind, slot } from "@gaia/schema";

/**
 * A landmark: one great thing that rises above its region, so a person can
 * see it through the haze and steer by it. At most one per region; when Jev
 * would make more, the most probable wins.
 */
export const landmark = kind({
  id: "landmark",
  subject: "file",
  doc: "A great thing that rises above its region and can be seen and steered by from far away.",
  represents: "The one file a region is organized around: its entry point, or the module most of its files import.",
  slots: {
    form: slot("Landmark"),
    motion: slot("Motion", { optional: true }),
    palette: slot("Palette"),
  },
  facts: {
    // Grows with the file's reach: how many files import it.
    scale: (f) => Math.min(1.25, Math.max(0.85, 0.8 + Math.log2(f.importedBy.length + 1) / 12)),
  },
});
