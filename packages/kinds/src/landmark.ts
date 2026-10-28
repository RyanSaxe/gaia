import { kind, slot } from "@gaia/schema";

/**
 * A landmark, a large structure that rises above the land, so a person can
 * see it through the haze and navigate by it. It represents one entity, file
 * or definition, as a building does. Only the world's most important things
 * are offered it, and among them Jev decides.
 */
export const landmark = kind({
  id: "landmark",
  subject: "thing",
  doc: "A great thing a person knows from far across the land and finds their way by, standing for one thing in the code: a package, a file or a definition.",
  slots: {
    form: slot("Landmark", {
      ask: "the great thing is the feeling a person carries away from it across the land: choose the one whose feel suits the code it stands for.",
    }),
    motion: slot("Motion", { optional: true, ask: "whether it moves in the wind, as a living thing does." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it stands out from its land." }),
  },
  facts: {
    // Scale grows with how much code depends on it, and a little with its line count.
    scale: (e) => Math.min(1.25, Math.max(0.85, 0.78 + Math.log2(e.dependents.length + 1) / 12 + Math.log2(e.lines + 1) / 160)),
  },
});
