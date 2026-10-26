import { kind, slot } from "@gaia/schema";

/** The land of one region: its shape, its ground, its air and the palette families native to it. */
export const biome = kind({
  id: "biome",
  subject: "region",
  doc: "The land of one region: its shape, its ground, its air and the palette families native to it.",
  slots: {
    relief: slot("Relief", {
      ask: "its landform is how walking through the directory's code feels underfoot: choose the land whose feel suits it.",
    }),
    cover: slot("Ground", {
      ask: "its ground cover is what brushes your feet as you walk through the directory's code: choose the cover whose feel suits it.",
    }),
    air: slot("Atmosphere", {
      optional: true,
      ask: "its air is the mood that hangs over the directory's code: choose the air whose feel suits it.",
    }),
    accents: slot("Accents", { optional: true, ask: "small drifting things, petals, leaves or fireflies, give the air a mood: a directory whose code feels lively, blooming, old and settled, or alive after dark has them; one that feels plain and workmanlike has none." }),
    natives: slot("Natives", { ask: "its native families are the colors that belong to the directory's land." }),
  },
  facts: { extent: (r) => r.extent },
});
