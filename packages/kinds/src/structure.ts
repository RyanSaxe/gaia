import { kind, slot } from "@gaia/schema";

/**
 * A building that stands for one entity: a package, crate, service, app or
 * module with a name, a boundary and things that depend on it. Jev decides
 * which entities become buildings (and which landmarks) and which building
 * suits each one. The
 * footprint lays out the plan; the body, roof, feature, openings and
 * ornaments all build on that one plan, so they agree by construction. The
 * body, roof and feature are settled first, so the openings and ornaments
 * Jev picks suit them.
 */
export const structure = kind({
  id: "structure",
  subject: "entity",
  doc: "A lived-in building that stands for one entity of the code: a package, crate, service, app or module.",
  represents:
    "Entities the rest of the code leans on: packages and crates others import, services and apps that run, and modules with a public surface. Jev chooses whether an entity stands as a building or a landmark: a lived-in, workaday one suits a building. Its massing, storeys and roofs say how big and how gathered it is, and its feature says what it does: a mill for one that turns input into output, a tower for one that keeps records or watches over others.",
  slots: {
    footprint: slot("Footprint", {
      ask: "its plan is how the entity's code is put together: one block for a single, focused purpose, an L or a T for a main part with a concern at its side, a long range for stages that hand work along in a row, a cluster for many modules working together. Its size and storeys grow with how much code it holds and how much it offers the rest, and how trim or crooked it stands says how tidy or makeshift that code is.",
    }),
    body: slot("Walls", {
      on: "footprint",
      ask: "its walls say what the entity is made of: heavy stone for code that is old, steady and leaned on, light timber framing for newer code that is still being reshaped.",
    }),
    roof: slot("Roof", {
      on: "footprint",
      ask: "its roof says how the entity keeps what is inside it: soft thatch for informal, homely code, neat courses of tiles or slate for tidy code with a clear public face.",
    }),
    feature: slot("Feature", {
      on: "footprint",
      optional: true,
      ask: "a feature says what the entity does for the rest of the code, when it plainly does one thing the others see: a tower for one that keeps records or watches over others, a waterwheel for one that turns what it is given into something new.",
    }),
    openings: slot("Openings", {
      on: "footprint",
      ask: "its windows and door say how open the entity is: many for one with a wide surface the rest of the code uses, few for one that keeps to itself.",
    }),
    ornaments: slot("Dressing", { on: "footprint", ask: "the small things around it say how cared for and lived in the entity's code is." }),
    palette: slot("Palette", { ask: "its colors say the entity's mood, and how it sits on its land." }),
  },
  stages: [
    ["footprint", "body", "roof", "feature", "palette"],
    ["openings", "ornaments"],
  ],
  facts: {
    // Footprint from the entity's line count, storeys from its public
    // surface, and how far a feature reaches (how tall a tower stands) from
    // how much of the code depends on it.
    size: (e) => Math.min(1.25, Math.max(0.8, Math.log2(e.lines + 1) / 13)),
    floors: (e) => 1 + Math.min(1, e.exports / 40),
    reach: (e) => Math.min(1, e.dependents.length / 8),
  },
});
