import { kind, slot } from "@gaia/schema";

/**
 * A bush that stands for one thing in the code, as a tree does, composed from
 * a bush's parts alone (its `Composing` library): a shrub's, a bramble's or a
 * sapling's frame, its bark, a crown on the frame and anything hanging in it.
 */
export const bush = kind({
  id: "bush",
  subject: "thing",
  doc: "A bush that grows knee to head high, standing for one thing in the code: how it grows, what it wears and how it moves say how that code feels.",
  slots: {
    form: slot("Skeleton", { ask: "its frame is how the bush holds itself, low or reaching, tidy or tangled: choose the frame whose feel suits the code it stands for." }),
    bark: slot("Surface", { on: "form", ask: "its bark is how weathered the code it stands for feels to the touch." }),
    crown: slot("Foliage", { on: "form", ask: "its leaves are the first thing a person feels about it from the path: choose the leaves whose feel suits the code it stands for." }),
    bloom: slot("Ornament", {
      on: "crown",
      optional: true,
      ask: "flowers, pods, berries or fruit among its leaves say the code it stands for feels generous or in its season; a bush whose code feels plain and workmanlike bears none.",
    }),
    motion: slot("Motion", { ask: "how it moves in the wind says how restless or settled the code it stands for feels." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it sits on its land." }),
  },
  facts: {},
});
