import { kind, slot } from "@gaia/schema";

/**
 * A landmark: a great thing that rises above the land, so a person can see
 * it through the haze and steer by it. It stands for one thing in the code,
 * as a building does: an entity, a file or a definition. Only the things
 * most important to the world are offered it; among them, Jev decides.
 */
export const landmark = kind({
  id: "landmark",
  subject: "thing",
  doc: "A great thing a person knows from far across the land and finds their way by, standing for one thing in the code: a package, a file or a definition.",
  represents: "The very few things in the code a person steers by, whatever they are: a package, a file or a single definition the whole repository turns on.",
  slots: {
    form: slot("Landmark", {
      ask: "the great thing is the feeling a person carries away from it across the land: choose the one whose feel suits the code it stands for.",
    }),
    motion: slot("Motion", { optional: true, ask: "whether it moves in the wind, as a living thing does." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it stands out from its land." }),
  },
  facts: {
    // Grows with its reach (how much depends on it) and a little with its size.
    scale: (e) => Math.min(1.25, Math.max(0.85, 0.78 + Math.log2(e.dependents.length + 1) / 12 + Math.log2(e.lines + 1) / 160)),
  },
});
