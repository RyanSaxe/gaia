import { kind, slot } from "@gaia/schema";

/**
 * A rock or a piece of landform that stands for one file. Rocks stand for
 * files that hold data rather than logic, so they never grow; only their
 * moss shows the file's health.
 */
export const rock = kind({
  id: "rock",
  subject: "file",
  doc: "A boulder, a stone, a cluster of stones or a ledge of bedrock that stands for one file.",
  represents: "Files that hold data rather than logic: configuration, schemas, fixtures, lockfiles and generated output.",
  slots: {
    form: slot("Rock"),
    moss: slot("Overgrowth", { on: "form", optional: true }),
    palette: slot("Palette"),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 9)),
  },
});
