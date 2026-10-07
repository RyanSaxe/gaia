import { kind, slot } from "@gaia/schema";

export const ground = kind({
  id: "ground",
  doc: "The shape of the land in one region of the world.",
  represents: "Directories: each directory is a region of ground.",
  slots: {
    relief: slot("Relief"),
  },
  // The region's extent comes from the world layout, not from a file.
  facts: {},
});
