import { kind, slot } from "@gaia/schema";

/** The land of one region: its shape, its ground, its air and the palette families native to it. */
export const biome = kind({
  id: "biome",
  subject: "region",
  doc: "The land of one region: its shape, its ground, its air and the palette families native to it.",
  represents: "Directories: each directory is a region of the world.",
  slots: {
    relief: slot("Relief", {
      ask: "its landform says how the directory's code is shaped: a valley for code that work flows through from file to file, rolling hills for a family of many small pieces made alike, terraces for code that runs in ordered stages or checks other code, a basin for settled code much of the rest rests on, a level meadow for quiet ground such as writing or a root, dunes for configuration, data and tooling that shift around the code.",
    }),
    cover: slot("Ground", {
      ask: "its ground cover says what walking through the directory's code is like: lush grass for busy, well-kept code, moss for old and settled code, clover for many small pieces made alike, heather or steppe for sparse code that is rarely changed.",
    }),
    air: slot("Atmosphere", {
      optional: true,
      ask: "its air says how clearly the directory's code can be seen through: clear for code that is easy to follow, a haze or mist for code that is hard to see into.",
    }),
    accents: slot("Accents", { optional: true, ask: "small drifting things, such as petals or leaves, give the directory a mood of its own when it has one worth showing; most have none." }),
    natives: slot("Natives", { ask: "its native families are the colors that belong to the directory's land." }),
  },
  facts: { extent: (r) => r.extent },
});
