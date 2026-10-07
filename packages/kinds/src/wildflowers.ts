import { kind, slot } from "@gaia/schema";

/** A drift of one species of wildflower at ground level, standing for one small file. */
export const wildflowers = kind({
  id: "wildflowers",
  subject: "file",
  doc: "A drift of wildflowers of one species, swaying among the grass.",
  represents: "Small files that describe or decorate: documentation, notes, stylesheets and images.",
  slots: {
    drift: slot("Drift"),
    motion: slot("Motion"),
    palette: slot("Palette"),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 8)),
  },
});
