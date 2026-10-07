import { kind, slot } from "@gaia/schema";

/**
 * A building that stands for one central file. The footprint lays out the
 * plan; the body, roof, openings and ornaments all build on that one plan,
 * so they agree by construction. The body and roof are settled first, so the
 * openings and ornaments Jev picks suit them.
 */
export const structure = kind({
  id: "structure",
  subject: "file",
  doc: "A lived-in building that stands for one source file that much of the code depends on.",
  represents: "Central files many others import: shared modules, core services, configuration and entry points.",
  slots: {
    footprint: slot("Footprint"),
    body: slot("Walls", { on: "footprint" }),
    roof: slot("Roof", { on: "footprint" }),
    openings: slot("Openings", { on: "footprint" }),
    ornaments: slot("Dressing", { on: "footprint" }),
    palette: slot("Palette"),
  },
  stages: [
    ["footprint", "body", "roof", "palette"],
    ["openings", "ornaments"],
  ],
  facts: {
    // Footprint from line count, storeys from how much the file exports.
    size: (f) => Math.min(1.25, Math.max(0.8, Math.log2(f.lines + 1) / 9)),
    floors: (f) => 1 + Math.min(1, f.symbols.filter((s) => s.exported).length / 24),
  },
});
