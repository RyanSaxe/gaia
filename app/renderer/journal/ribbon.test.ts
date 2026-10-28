import { describe, expect, it } from "vitest";
import { RIBBON_LIE, RIBBON_POSES, type RibbonPose, ribbonSvg } from "./ribbon.ts";

/** Every corner of the ribbon's drawn quads in the book's pixels, with the spine at x 0 and the page's center at y 0. */
const cornersOf = (svg: string): [number, number][] =>
  [...svg.matchAll(/<path d="M([^"]+)Z" fill/g)].flatMap((m) => (m[1] as string).split("L").map((p) => p.split(" ").map(Number) as [number, number]));

/** Where a corner lands once posed, as CSS rotates it about the spine (`ribbonTransform`). */
const posed = ([x, y]: [number, number], p: RibbonPose): [number, number] => {
  const a = (p.deg * Math.PI) / 180;
  return [x * Math.cos(a) + p.off * Math.sin(a), y];
};

describe("the journal's silk ribbon", () => {
  it("lies in the gutter of its page, well clear of the writing, which starts 56 of the book's pixels from the spine", () => {
    const corners = cornersOf(ribbonSvg(RIBBON_LIE).svg);
    expect(corners.length).toBeGreaterThan(100);
    // Over the page's height (660 pixels, centered), the ribbon stays within the gutter's shadow. Below the page it may lie along the edge.
    const onPage = corners.filter(([, y]) => y <= 330);
    expect(Math.max(...onPage.map(([x]) => x))).toBeLessThan(24);
  });

  it("shows its head and tail in the same place wherever its page lies, mirrored about the spine on the left", () => {
    // Only the parts above and below the pages show under other leaves.
    const shown = cornersOf(ribbonSvg(RIBBON_LIE).svg).filter(([, y]) => Math.abs(y) > 330);
    expect(shown.length).toBeGreaterThan(50);
    // Skips `before-lifted`, which moves with the cover's lifted edge.
    for (const [name, pose] of Object.entries(RIBBON_POSES).filter(([n]) => n !== "before-lifted")) {
      const across = name === "before-open" ? -1 : 1;
      for (const c of shown) {
        const [x, y] = posed(c, pose);
        expect(Math.abs(x - across * c[0]), `${name} at ${c.join(", ")}`).toBeLessThan(0.05);
        expect(y).toBe(c[1]);
      }
    }
  });
});
