import { kind, slot } from "@gaia/schema";

/** A drift of one species of low plant at ground level, such as wildflowers, ferns or mushrooms, that represents one thing in the code. */
export const wildflowers = kind({
  id: "wildflowers",
  subject: "thing",
  doc: "A drift of one kind of low plant among the grass, wildflowers, ferns or mushrooms, standing for one thing in the code: how it grows and moves says how that code feels.",
  slots: {
    drift: slot("Drift", { ask: "the plants are the whole feel of the drift as a person walks into it: choose the plants whose feel suits the code it stands for." }),
    motion: slot("Motion", { ask: "how it moves in the wind says how restless or settled the code it stands for feels." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it sits in the grass." }),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 8)),
  },
});
