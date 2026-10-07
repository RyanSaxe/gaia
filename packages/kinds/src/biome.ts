import { kind, slot } from "@gaia/schema";

/** The land of one region: its shape, its ground, its air and the palette families native to it. */
export const biome = kind({
  id: "biome",
  subject: "region",
  doc: "The land of one region: its shape, its ground, its air and the palette families native to it.",
  represents: "Directories: each directory is a region of the world.",
  slots: {
    relief: slot("Relief"),
    cover: slot("Ground"),
    air: slot("Atmosphere", { optional: true }),
    accents: slot("Accents", { optional: true }),
    natives: slot("Natives"),
  },
  facts: { extent: (r) => r.extent },
});
