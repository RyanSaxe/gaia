import { kind, slot } from "@gaia/schema";

/** A drift of one species of low plant at ground level, such as wildflowers, ferns or mushrooms, that represents one thing in the code. */
export const wildflowers = kind({
  id: "wildflowers",
  subject: "thing",
  doc: "A drift of one kind of low plant in the grass, such as wildflowers, ferns or mushrooms, that represents one thing in the code. How it grows and moves shows how that code feels.",
  slots: {
    drift: slot("Drift", { ask: "its plants set how the drift feels to a person who walks into it. Choose the plants whose feel suits the code it represents." }),
    motion: slot("Motion", { ask: "how it moves in the wind shows how restless or settled the code it represents feels." }),
    palette: slot("Palette", { ask: "its colors show the mood of the code it represents and how it fits in the grass." }),
  },
  facts: {
    scale: (f) => Math.min(1.3, Math.max(0.6, Math.log2(f.lines + 1) / 8)),
  },
});
