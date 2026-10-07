import { kind, slot } from "@gaia/schema";

/**
 * The art direction one repository's whole world shares: its light, sky,
 * season and wind. Regions vary their own ground and air beneath it.
 */
export const world = kind({
  id: "world",
  subject: "repository",
  doc: "The art direction of a whole world: its light, sky, season and wind.",
  represents: "The whole repository, read from its languages, size, age, activity and health.",
  slots: {
    light: slot("Light"),
    sky: slot("Sky"),
    season: slot("Season"),
    wind: slot("Wind"),
  },
  // Light and season first, so the sky and wind Jev picks agree with them.
  stages: [
    ["light", "season"],
    ["sky", "wind"],
  ],
  facts: {},
});
