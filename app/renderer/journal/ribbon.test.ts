import { describe, expect, it } from "vitest";
import { RIBBON_LIES, ribbonSvg } from "./ribbon.ts";

/** Every corner of the ribbon's drawn silk, in the book's own pixels: the spine at x 0, the page's middle at y 0. */
const cornersOf = (svg: string): [number, number][] =>
  [...svg.matchAll(/<path d="M([^"]+)Z" fill/g)].flatMap((m) => (m[1] as string).split("L").map((p) => p.split(" ").map(Number) as [number, number]));

describe("the journal's silk ribbon", () => {
  it("lies in the gutter of its page, well clear of the writing, which starts 56 of the book's pixels from the spine", () => {
    const corners = cornersOf(ribbonSvg(RIBBON_LIES.here).svg);
    expect(corners.length).toBeGreaterThan(100);
    // Over the page's height (660 pixels, centred), the silk keeps within the fold's shadow; below the foot it may lie along the edge.
    const onPage = corners.filter(([, y]) => y <= 330);
    expect(Math.max(...onPage.map(([x]) => x))).toBeLessThan(24);
  });
});
