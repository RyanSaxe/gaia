import { kind, slot } from "@gaia/schema";

/**
 * A rock, a piece of landform or old wood lying in the grass that stands for
 * one file. Rocks stand for files that hold data rather than logic, so they
 * never grow; their moss, cracks and rotting wood show the file's health.
 */
export const rock = kind({
  id: "rock",
  subject: "file",
  doc: "A boulder, a stone, a cluster of stones, a ledge of bedrock, a fallen log or an old stump that stands for one file.",
  slots: {
    form: slot("Rock"),
    moss: slot("Overgrowth", { on: "form", optional: true }),
    palette: slot("Palette"),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 9)),
  },
});
