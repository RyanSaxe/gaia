import { kind, slot } from "@gaia/schema";

/**
 * A landmark: a great thing that rises above the land, so a person can see
 * it through the haze and steer by it. It stands for an entity, as a
 * building does; Jev decides which entities become landmarks and which
 * become buildings, by how prominent each is. No rule fixes how many.
 */
export const landmark = kind({
  id: "landmark",
  subject: "entity",
  doc: "A great thing that rises above the land and can be seen and steered by from far away, standing for one entity of the code.",
  represents:
    "Entities a person steers by: packages, crates, services and apps much of the code depends on, or that hold the world together. Jev chooses whether an entity stands as a landmark or a building; a prominent one suits a landmark, a lived-in workaday one a building.",
  slots: {
    form: slot("Landmark", {
      ask: "the great thing says what part this entity plays for the code that steers by it: a great tree for living code much of the rest grows from, a lookout tower for code that watches over or coordinates the rest and gives it its bearings, standing stones for the old foundations the rest was set on.",
    }),
    motion: slot("Motion", { optional: true, ask: "whether it moves in the wind, as a living thing does." }),
    palette: slot("Palette", { ask: "its colors say the entity's mood, and how it stands out from its land." }),
  },
  facts: {
    // Grows with the entity's reach (how many entities depend on it) and a little with its size.
    scale: (e) => Math.min(1.25, Math.max(0.85, 0.78 + Math.log2(e.dependents.length + 1) / 12 + Math.log2(e.lines + 1) / 160)),
  },
});
