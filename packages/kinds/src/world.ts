import { kind, slot } from "@gaia/schema";

/**
 * The art direction for one repository's whole world: its light, sky and
 * wind. Each region sets its own ground and air beneath it.
 */
export const world = kind({
  id: "world",
  subject: "repository",
  doc: "The art direction of a whole world: its light, sky and wind.",
  slots: {
    light: slot("Light", {
      ask: "its light shows how the whole codebase feels to work in. Choose the light whose feel suits the codebase.",
    }),
    sky: slot("Sky", {
      ask: "its sky shows the codebase's weather: open and fair for code that is easy to read and in good health, heavier cloud for code that is tangled or hard to follow.",
    }),
    wind: slot("Wind", {
      ask: "its wind shows how much the codebase is changing: still air for one barely changed lately, a breeze or gusts for one that many people are changing.",
    }),
  },
  // Light first, so the sky and wind Jev picks agree with it.
  stages: [["light"], ["sky", "wind"]],
  facts: {},
});
