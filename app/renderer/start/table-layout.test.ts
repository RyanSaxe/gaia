import { describe, expect, it } from "vitest";
import { RECENT_KEPT } from "../../world-service/recent.ts";
import { LOGO_ASPECT } from "../brand/logo.ts";
import { NAME_ROOM, crosses, tableLayout } from "./table-layout.ts";

/** A card with the room its name takes beneath it: left, top, right, bottom. */
const footprint = (c: { x: number; y: number; side: number }, name: number): [number, number, number, number] => [c.x - c.side / 2, c.y - c.side / 2, c.x + c.side / 2, c.y + c.side / 2 + name * NAME_ROOM];
const apart = (a: readonly number[], b: readonly number[]): boolean => (a[2] as number) <= (b[0] as number) || (b[2] as number) <= (a[0] as number) || (a[3] as number) <= (b[1] as number) || (b[3] as number) <= (a[1] as number);

describe("the map table's layout", () => {
  for (const phone of [false, true]) {
    for (let n = 0; n <= RECENT_KEPT; n++) {
      it(`lays ${n} worlds on the ${phone ? "phone's" : "desktop's"} sheet clear of each other, the logo, the words, the line and the quill`, () => {
        const l = tableLayout(phone, n);
        expect(l.cards).toHaveLength(n);
        const logo = [l.logo.x, l.logo.y, l.logo.x + l.logo.w, l.say.y];
        // The question above the line, the line, and the folder's words beneath a refusal: two lines of it on a phone.
        const words = [l.line.x0, l.line.y - l.line.size * 3.1, l.line.x1, l.line.y + l.line.size * (phone ? 6.3 : 5)];
        expect(words[3]).toBeLessThan(l.sheet.h - 0.02);
        const boxes = l.cards.map((c) => footprint(c, l.name));
        for (const [i, box] of boxes.entries()) {
          expect(box[0]).toBeGreaterThan(0.03);
          expect(box[2]).toBeLessThan(l.sheet.w - 0.03);
          expect(box[1]).toBeGreaterThan(l.say.y);
          expect(apart(box, logo)).toBe(true);
          expect(apart(box, words)).toBe(true);
          for (const other of boxes.slice(i + 1)) expect(apart(box, other)).toBe(true);
          expect(crosses(l.quill.nib, l.quill.tip, box)).toBe(false);
        }
        // Names side by side in a row never run into each other.
        for (const a of l.cards) for (const b of l.cards) if (a !== b && Math.abs(a.y - b.y) < 1e-6) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(a.nameWidth);
        expect(l.logo.w / LOGO_ASPECT).toBeLessThan(l.say.y - l.logo.y);
      });
    }
    it(`gives fewer worlds larger cards on the ${phone ? "phone" : "desktop"}, and six still a hand's width`, () => {
      const sides = Array.from({ length: RECENT_KEPT }, (_, k) => tableLayout(phone, k + 1).cards[0]?.side ?? 0);
      for (let k = 1; k < sides.length; k++) expect(sides[k]).toBeLessThanOrEqual(sides[k - 1] as number);
      expect(sides[0]).toBeGreaterThanOrEqual(0.27);
      expect(sides[RECENT_KEPT - 1]).toBeGreaterThanOrEqual(0.1);
    });
  }
});
