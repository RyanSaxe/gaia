import { kind, slot } from "@gaia/schema";

/**
 * A stone, a piece of landform or old wood lying in the grass that stands for
 * one thing in the code: an entity, a file or a definition. It never grows;
 * its moss, cracks and rotting wood show how the code fares.
 */
export const rock = kind({
  id: "rock",
  subject: "thing",
  doc: "A boulder, a stone, a family of stones, a ledge of bedrock, a fallen log or an old stump lying in the grass, standing for one thing in the code: its shape and what grows on it say how that code feels.",
  slots: {
    form: slot("Rock", { ask: "its shape is the whole feel of it as a person comes upon it in the grass: choose the shape whose feel suits the code it stands for." }),
    moss: slot("Overgrowth", { on: "form", optional: true, ask: "moss or lichen on it says the code it stands for feels old and long left to settle; code that feels fresh or busy grows none." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it sits on its land." }),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 9)),
  },
});
