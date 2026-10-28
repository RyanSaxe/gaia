import { kind, slot } from "@gaia/schema";

/**
 * A tree that represents one entity, file or definition. Jev composes it part
 * by part from a tree's parts alone (its `Composing` library): a frame, its
 * bark, a crown on the frame and anything hanging in the crown. Its size comes
 * from the code it represents when the world places it, and the blueprint
 * holds only its look.
 */
export const tree = kind({
  id: "tree",
  subject: "thing",
  doc: "A tree, taller than a person, that represents one thing in the code. Its shape, bark, leaves and movement show how that code feels.",
  slots: {
    form: slot("Skeleton", { ask: "its frame sets how the tree rises and spreads. Choose the frame whose feel suits the code it represents." }),
    bark: slot("Surface", { on: "form", ask: "its bark shows how weathered the code it represents feels." }),
    crown: slot("Foliage", { on: "form", ask: "its crown of leaves sets the tree's mood. Choose the leaves whose feel suits the code it represents." }),
    bloom: slot("Ornament", {
      on: "crown",
      optional: true,
      ask: "flowers, pods, berries or fruit in its crown show that the code it represents feels generous or in its prime. A tree whose code feels plain and workmanlike has none.",
    }),
    motion: slot("Motion", { ask: "how it moves in the wind shows how restless or settled the code it represents feels." }),
    palette: slot("Palette", { ask: "its colors show the mood of the code it represents and how it fits with its land." }),
  },
  facts: {},
});
