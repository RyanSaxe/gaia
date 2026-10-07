import { kind, slot } from "@gaia/schema";

/**
 * The world's art direction: one blueprint per repository, filled from
 * whole-repository facts. Regions and components are colored inside it.
 */
export const world = kind({
  id: "world",
  doc: "The art direction of a whole world: its light, sky, season, air, ground cover and wind.",
  represents: "The whole repository, read from its overall facts: languages, size, age, activity and health.",
  slots: {
    light: slot("Light"),
    sky: slot("Sky"),
    season: slot("Season"),
    air: slot("Atmosphere"),
    ground: slot("Ground"),
    drift: slot("Accents", { optional: true }),
    wind: slot("Wind"),
  },
  // Per-file bindings do not apply: the world reads the repository as a whole.
  facts: {},
});
