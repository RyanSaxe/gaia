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
      ask: "its plan is how the code it stands for is put together: one block for a single, focused purpose, an L or a T for a main part with a concern at its side, a long range for stages that hand work along in a row, a cluster for many modules working together. Its size and storeys grow with how much code it holds and how much it offers the rest, and how trim or crooked it stands says how tidy or makeshift that code is.",
    }),
    body: slot("Walls", {
      on: "footprint",
      ask: "its walls say what the code it stands for is made of: heavy stone for code that is old, steady and leaned on, light timber framing for newer code that is still being reshaped.",
    }),
    roof: slot("Roof", {
      on: "footprint",
      ask: "its roof says how the code it stands for keeps what is inside it: soft thatch for informal, homely code, neat courses of tiles or slate for tidy code with a clear public face.",
    }),
    feature: slot("Feature", {
      on: "footprint",
      optional: true,
      ask: "a feature gives the building a character of its own, as most buildings have: something beside the house that shows how the code it stands for feels. Only a building whose code has no feel of its own goes without.",
    }),
    openings: slot("Openings", {
      on: "footprint",
      ask: "its windows and door say how open the code it stands for is: many for one with a wide surface the rest of the code uses, few for one that keeps to itself.",
    }),
    ornaments: slot("Dressing", { on: "footprint", ask: "the small things around it say how cared for and lived in the code it stands for is." }),
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
