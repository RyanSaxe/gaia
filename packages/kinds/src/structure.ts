import { kind, slot } from "@gaia/schema";

/**
 * A building that represents one entity, file or definition. Jev chooses each
 * thing's form among the forms its importance allows, and composes the
 * building part by part. The footprint lays out the plan, and the body, roof,
 * feature, openings and ornaments all build on that one plan, so they agree by
 * construction. Jev chooses the body, roof and feature first, so the openings
 * and ornaments it picks suit them.
 */
export const structure = kind({
  id: "structure",
  subject: "thing",
  doc: "A lived-in building that represents one thing in the code: a package, a file or a definition.",
  slots: {
    footprint: slot("Footprint", {
      ask: "its plan sets how the building sits on the land, how far it spreads and how high it rises. Choose the plan, shape and storeys whose feel suits the code it represents. Make it trim if that code feels tidy, or crooked if it feels makeshift.",
    }),
    body: slot("Walls", {
      on: "footprint",
      ask: "its walls are the first thing a person feels about it from the path. Choose the walls whose feel suits the code it represents.",
    }),
    roof: slot("Roof", {
      on: "footprint",
      ask: "its roof sets the building's mood. Choose the roof whose feel suits the code it represents.",
    }),
    feature: slot("Feature", {
      on: "footprint",
      optional: true,
      ask: "a feature beside the house gives the building its own character and shows how the code it represents feels. Most buildings have one. Only a building whose code has no distinct feel goes without.",
    }),
    openings: slot("Openings", {
      on: "footprint",
      ask: "its windows and door show how open and welcoming the code it represents feels: many for code that feels open to everyone, few for code that feels closed and private.",
    }),
    ornaments: slot("Dressing", { on: "footprint", ask: "the small things around it show how cared for and lived in the code it represents feels." }),
    palette: slot("Palette", { ask: "its colors show the mood of the code it represents and how it fits with its land." }),
  },
  stages: [
    ["footprint", "body", "roof", "feature", "palette"],
    ["openings", "ornaments"],
  ],
  facts: {
    // The footprint scales with the line count of the code it represents,
    // storeys with its exports, and a feature's reach, such as a tower's
    // height, with how much code depends on it.
    size: (e) => Math.min(1.25, Math.max(0.8, Math.log2(e.lines + 1) / 13)),
    floors: (e) => 1 + Math.min(1, e.exports / 40),
    reach: (e) => Math.min(1, e.dependents.length / 8),
  },
});
