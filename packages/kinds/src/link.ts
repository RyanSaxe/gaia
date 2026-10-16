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
  slots: {
    route: slot("Route", {
      ask: "the trail says how much one entity leans on the other: wide and well trodden when most of its files import the other, a beaten path edged with stones for a deliberate, kept connection, a faint track for one or a few imports; how directly it runs says how direct the dependency is.",
    }),
  },
  facts: {},
});
