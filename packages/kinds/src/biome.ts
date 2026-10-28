import { kind, slot } from "@gaia/schema";

/** The land of one region: its shape, its ground, its air and the palette families native to it. */
export const biome = kind({
  id: "biome",
  subject: "region",
  doc: "The land of one region, with its shape, ground, air and native palette families.",
  slots: {
    relief: slot("Relief", {
      ask: "its landform shows how walking through the directory's code feels underfoot. Choose the landform whose feel suits the directory.",
    }),
    cover: slot("Ground", {
      ask: "its ground cover is what a person walks through in the directory's land. Choose the cover whose feel suits the directory.",
    }),
    air: slot("Atmosphere", {
      optional: true,
      ask: "its air sets the mood over the directory's land. Choose the air whose feel suits the directory.",
    }),
    accents: slot("Accents", { optional: true, ask: "small drifting things, such as petals, leaves or fireflies, give the air a mood. A directory whose code feels lively, blooming, old and settled, or alive after dark has them, and one whose code feels plain and workmanlike has none." }),
    natives: slot("Natives", { ask: "its native families are the colors that belong to the directory's land." }),
  },
  facts: { extent: (r) => r.extent },
});
