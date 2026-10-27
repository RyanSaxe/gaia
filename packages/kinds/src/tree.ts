import { kind, slot } from "@gaia/schema";

/**
 * A tree that stands for one thing in the code: an entity, a file or a
 * definition. Jev composes it part by part from the tree's parts alone
 * (`TREE_PRIMITIVES`): a frame, its bark, a crown on the frame and anything
 * hanging in the crown. Its size comes from the code it stands for, when it
 * stands; the blueprint holds only its look.
 */
export const tree = kind({
  id: "tree",
  subject: "thing",
  doc: "A tree that grows tall over a person, standing for one thing in the code.",
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
