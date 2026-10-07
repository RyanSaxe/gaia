// Route primitives: how a trail between two places looks and runs. The
// terrain finds the route over the ground; these say how wide and worn the
// tread is, what lines it, how freely it wanders and how it crosses water.

import { type RouteSpec, primitive, t } from "@gaia/schema";

export const trailParams = {
  width: t.scale("How wide the trail is", {
    "a narrow footpath": 0.9,
    "a path two could walk": 1.4,
    "a broad cart track": 2.2,
  }),
  wear: t.scale("How worn the tread is", {
    "faint, half grassed over": 0.4,
    "well trodden": 0.7,
    "bare, beaten earth": 0.95,
  }),
  edging: t.choice("What lines the trail's edges", {
    none: "Nothing: the grass meets the tread",
    stones: "Small stones set along both edges",
  }),
  winding: t.scale("How freely the trail wanders", {
    "nearly straight": 0.1,
    "gently curving": 0.45,
    meandering: 0.85,
  }),
  crossing: t.choice("How the trail crosses a stream", {
    "stepping stones": "Flat stones set across the water",
    footbridge: "A small wooden footbridge",
  }),
};

export const trail = primitive({
  id: "trail@1",
  role: "Route",
  doc: "A trail of worn earth through the grass, following the easiest ground between two places.",
  params: trailParams,
  build: (p): RouteSpec => ({
    width: p.width,
    wear: p.wear,
    edging: p.edging,
    winding: p.winding,
    crossing: p.crossing === "footbridge" ? "footbridge" : "stepping-stones",
  }),
});

export const ROUTE_PRIMITIVES = [trail];
