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
  doc: "A great thing a person knows from far across the land and finds their way by, representing one thing in the code: a package, a file or a definition.",
  slots: {
    form: slot("Landmark", {
      ask: "the landmark is the feeling a person takes away from it. Choose the landmark whose feel suits the code it represents.",
    }),
    motion: slot("Motion", { optional: true, ask: "whether it moves in the wind, like a living thing." }),
    palette: slot("Palette", { ask: "its colors show the mood of the code it represents and how it stands out from its land." }),
  },
  facts: {
    // Scale grows with how much code depends on it, and a little with its line count.
    scale: (e) => Math.min(1.25, Math.max(0.85, 0.78 + Math.log2(e.dependents.length + 1) / 12 + Math.log2(e.lines + 1) / 160)),
  },
});
