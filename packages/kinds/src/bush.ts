import { kind, slot } from "@gaia/schema";

/**
 * A bush that stands for one thing in the code, as a tree does, composed from
 * a bush's parts alone (`BUSH_PRIMITIVES`): a shrub's, a bramble's or a
 * sapling's frame, its bark, a crown on the frame and anything hanging in it.
 */
export const bush = kind({
  id: "bush",
  subject: "thing",
  doc: "A bush that grows knee to head high, standing for one thing in the code.",
  slots: {
    form: slot("Skeleton"),
    bark: slot("Surface", { on: "form" }),
    crown: slot("Foliage", { on: "form" }),
    bloom: slot("Ornament", { on: "crown", optional: true }),
    motion: slot("Motion"),
    palette: slot("Palette"),
  },
  facts: {},
});
