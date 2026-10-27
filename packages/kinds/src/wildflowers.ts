import { kind, slot } from "@gaia/schema";

/** A drift of one species of low plant at ground level (wildflowers, ferns or mushrooms), standing for one small file. */
export const wildflowers = kind({
  id: "wildflowers",
  subject: "file",
  doc: "A drift of one kind of low plant among the grass: wildflowers, ferns or mushrooms.",
  slots: {
    drift: slot("Drift"),
    motion: slot("Motion"),
    palette: slot("Palette"),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 8)),
  },
});
