import { kind, slot } from "@gaia/schema";

/**
 * A trail worn between two entities' places where one depends on the other.
 * Jev decides which dependencies a person would walk between; the
 * composition budget keeps the most probable few, so trails never dominate
 * the world. The terrain finds the route; the blueprint only says how the
 * trail looks. Its wear follows the vitality of the two entities it joins.
 */
export const link = kind({
  id: "link",
  subject: "link",
  doc: "A trail worn into the ground between two entities where one depends on the other.",
  represents: "Dependencies between entities a person would walk between: a package, crate, service or app that leans heavily on another.",
  slots: {
    route: slot("Route"),
  },
  facts: {
    // How much traffic the dependency carries: how many of the importing entity's files use the other.
    traffic: (d) => Math.min(1, Math.log2(d.importers + 1) / 5),
  },
});
