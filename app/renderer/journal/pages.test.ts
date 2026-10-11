import { describe, expect, it } from "vitest";
import { thumbIndex } from "./pages.ts";

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
