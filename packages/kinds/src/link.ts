import { kind, slot } from "@gaia/schema";

/**
 * A trail worn between two places whose files depend on each other. Jev
 * decides which dependencies a person would walk between; the composition
 * budget keeps the most probable few, so trails never dominate the world.
 * The terrain finds the route; the blueprint only says how the trail looks.
 */
export const link = kind({
  id: "link",
  subject: "link",
  doc: "A trail worn into the ground between two places whose code depends on each other.",
  represents: "Dependencies a person would walk between: one file importing another that it leans on heavily.",
  slots: {
    route: slot("Route"),
  },
  facts: {
    uses: (l) => l.uses,
  },
});
