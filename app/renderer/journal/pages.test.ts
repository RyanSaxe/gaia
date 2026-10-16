import { describe, expect, it } from "vitest";
import type { Measure } from "../immersive/map-names.ts";
import { titleSize } from "./page.ts";
import { thumbIndex } from "./pages.ts";

describe("the world's name on the title page", () => {
  // Capitals as wide as their letters and spacing, as near as a test can measure without a browser.
  const measure: Measure = (text, font, spacing) => text.length * (0.72 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 0) + spacing);

  it("keeps its full size for a short name and for a long one that breaks into a few lines", () => {
    expect(titleSize("gaia", measure)).toBe(40);
    expect(titleSize("startOpenRouterStandIn", measure)).toBe(40);
    expect(titleSize("react-native-safe-area-context", measure)).toBe(40);
  });

  it("shrinks a name that would take more than three lines just enough to take three, and a run too long for one line", () => {
    const long = titleSize("react-native-safe-area-context-provider-for-every-platform", measure);
    expect(long).toBeLessThan(40);
    expect(long).toBeGreaterThan(22);
    expect(titleSize("supercalifragilistic", measure)).toBeLessThan(40);
  });

  it("never letters a name smaller than 22 px, however long", () => {
    expect(titleSize("supercalifragilisticexpialidocioustwice", measure)).toBe(22);
    expect(titleSize("a-".repeat(80) + "z", measure)).toBe(22);
  });
});

describe("the fore-edge's tabs", () => {
  it("are one per top folder while they fit, and past that a thumb index of even runs lettered by where each begins and ends", () => {
    const few = [".githooks", "app", "docs"];
    expect(thumbIndex(few).map((t) => t.label)).toEqual(few);
    const proving = ["crossings", "downs", "dunes", "fords", "hills", "hollow", "mixed", "moor", "pondside", "ruins", "terraces"];
    const tabs = thumbIndex(proving);
    expect(tabs).toHaveLength(7);
    // Every folder is under exactly one tab, in order.
    expect(tabs.flatMap((t) => proving.slice(t.from, t.to))).toEqual(proving);
    expect(tabs.map((t) => t.label)).toEqual(["c–do", "du", "f–hi", "ho", "m", "p", "r–t"]);
  });
});
