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
    footprint: slot("Footprint"),
    body: slot("Walls", { on: "footprint" }),
    roof: slot("Roof", { on: "footprint" }),
    feature: slot("Feature", { on: "footprint", optional: true }),
    openings: slot("Openings", { on: "footprint" }),
    ornaments: slot("Dressing", { on: "footprint" }),
    palette: slot("Palette"),
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
