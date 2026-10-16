import { kind, slot } from "@gaia/schema";

/**
 * The art direction one repository's whole world shares: its light, sky and
 * wind. Regions vary their own ground and air beneath it.
 */
export const world = kind({
  id: "world",
  subject: "repository",
  doc: "The art direction of a whole world: its light, sky and wind.",
  represents: "The whole repository, read from its languages, size, age, activity and health.",
  slots: {
    light: slot("Light", {
      ask: "its light says how the whole codebase feels to work in: low, warm light for an old and settled one, clear and bright for a young one still taking shape, soft and painterly for one kept with care.",
    }),
    sky: slot("Sky", {
      ask: "its sky says the codebase's weather: open and fair for code that is easy to read and in good health, heavier cloud for code that is tangled or hard to follow.",
    }),
    wind: slot("Wind", {
      ask: "its wind says how much the codebase is moving: still air for one barely touched lately, a breeze or gusts for one that many hands are changing.",
    }),
  },
  // Light first, so the sky and wind Jev picks agree with it.
  stages: [["light"], ["sky", "wind"]],
  facts: {},
});
