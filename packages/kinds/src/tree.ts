import { kind, slot } from "@gaia/schema";

/**
 * A tree that stands for one thing in the code: an entity, a file or a
 * definition. Jev composes it part by part from a tree's parts alone (its
 * `Composing` library): a frame, its bark, a crown on the frame and anything
 * hanging in the crown. Its size comes from the code it stands for when it
 * stands; the blueprint holds only its look.
 */
export const tree = kind({
  id: "tree",
  subject: "thing",
  doc: "A tree that grows tall over a person, standing for one thing in the code: how it rises, what it wears and how it moves say how that code feels.",
  slots: {
    form: slot("Skeleton", { ask: "its frame is the tree's whole bearing, how it rises and spreads: choose the frame whose feel suits the code it stands for." }),
    bark: slot("Surface", { on: "form", ask: "its bark is how weathered the code it stands for feels to the touch." }),
    crown: slot("Foliage", { on: "form", ask: "its crown is the mood it casts over the ground beneath it: choose the leaves whose feel suits the code it stands for." }),
    bloom: slot("Ornament", {
      on: "crown",
      optional: true,
      ask: "flowers, pods, berries or fruit in its crown say the code it stands for feels generous or in its season; a tree whose code feels plain and workmanlike bears none.",
    }),
    motion: slot("Motion", { ask: "how it moves in the wind says how restless or settled the code it stands for feels." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it sits on its land." }),
  },
  facts: {},
});
