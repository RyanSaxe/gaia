import { kind, slot } from "@gaia/schema";

/**
 * A stone, a piece of landform or old wood lying in the grass that represents
 * one entity, file or definition. It never grows. Its moss, cracks and rotting
 * wood show the code's vitality.
 */
export const rock = kind({
  id: "rock",
  subject: "thing",
  doc: "A boulder, a flat stone, a cluster of stones, a ledge of bedrock, a fallen log or an old stump in the grass that represents one thing in the code. Its shape and what grows on it show how that code feels.",
  slots: {
    form: slot("Rock", { ask: "its shape sets how it feels to a person who finds it in the grass. Choose the shape whose feel suits the code it represents." }),
    moss: slot("Overgrowth", { on: "form", optional: true, ask: "moss or lichen on it shows that the code it represents feels old and long untouched. Code that feels fresh or busy has none." }),
    palette: slot("Palette", { ask: "its colors show the mood of the code it represents and how it fits with its land." }),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 9)),
  },
});
