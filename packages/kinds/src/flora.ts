import { kind, slot } from "@gaia/schema";

export const flora = kind({
  id: "flora",
  subject: "file",
  doc: "A living plant that stands for one source file.",
  represents: "Files that hold logic: modules, components, services and scripts.",
  slots: {
    form: slot("Skeleton"),
    bark: slot("Surface", { on: "form" }),
    crown: slot("Foliage", { on: "form" }),
    bloom: slot("Ornament", { on: "crown", optional: true }),
    motion: slot("Motion"),
    palette: slot("Palette"),
  },
  facts: {
    scale: (f) => Math.min(1.4, Math.max(0.3, Math.log2(f.lines + 1) / 10)),
    age: (f) => f.git.daysSinceFirstCommit,
  },
});
