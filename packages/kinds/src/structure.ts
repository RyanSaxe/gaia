import { kind, slot } from "@gaia/schema";

/**
 * A building that stands for one thing in the code: an entity, a file or a
 * definition. Jev decides what each thing stands as, among the forms its
 * importance is offered, and composes the building part by part. The
 * footprint lays out the plan; the body, roof, feature, openings and
 * ornaments all build on that one plan, so they agree by construction. The
 * body, roof and feature are settled first, so the openings and ornaments
 * Jev picks suit them.
 */
export const structure = kind({
  id: "structure",
  subject: "thing",
  doc: "A lived-in building that stands for one thing in the code: a package, a file or a definition.",
  represents:
    "The few things in the code that much of the rest leans on, whatever they are: a package, a file or a single definition. Its massing, storeys and roofs say how big and how gathered it is, and its feature gives it a character of its own.",
  slots: {
    footprint: slot("Footprint", {
      ask: "its plan is the building's whole bearing, how it sits on the land, how it spreads and how high it rises: choose the plan, the shape and the storeys whose feel suits the code it stands for, and stand it trim or crooked as that code feels tidy or makeshift.",
    }),
    body: slot("Walls", {
      on: "footprint",
      ask: "its walls are the first thing a person feels about it from the path: choose the walls whose feel suits the code it stands for.",
    }),
    roof: slot("Roof", {
      on: "footprint",
      ask: "its roof is the mood it sits under: choose the roof whose feel suits the code it stands for.",
    }),
    feature: slot("Feature", {
      on: "footprint",
      optional: true,
      ask: "a feature gives the building a character of its own, as most buildings have: something beside the house that shows how the code it stands for feels. Only a building whose code has no feel of its own goes without.",
    }),
    openings: slot("Openings", {
      on: "footprint",
      ask: "its windows and door say how open and welcoming the code it stands for feels: many for code that greets everyone, few for code that keeps to itself.",
    }),
    ornaments: slot("Dressing", { on: "footprint", ask: "the small things around it say how cared for and lived in the code it stands for feels." }),
    palette: slot("Palette", { ask: "its colors say the mood of the code it stands for, and how it sits on its land." }),
  },
  stages: [
    ["footprint", "body", "roof", "feature", "palette"],
    ["openings", "ornaments"],
  ],
  facts: {
    // Footprint from the line count of the code it stands for, storeys from
    // its public surface, and how far a feature reaches (how tall a tower
    // stands) from how much of the code depends on it.
    size: (e) => Math.min(1.25, Math.max(0.8, Math.log2(e.lines + 1) / 13)),
    floors: (e) => 1 + Math.min(1, e.exports / 40),
    reach: (e) => Math.min(1, e.dependents.length / 8),
  },
});
