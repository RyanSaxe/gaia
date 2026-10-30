import { describe, expect, it } from "vitest";
import { type Piece, highlight } from "./highlight.ts";

const inked = (pieces: readonly Piece[]): string[] => pieces.filter((p) => p.ink !== undefined).map((p) => `${p.ink}:${p.text}`);

describe("code on a page", () => {
  it("inks keywords, strings, numbers, called names, types, properties and comments, a comment or string over several lines as one", () => {
    const lines = ["const limit = await spendLimit(engine); // dollars", "if (x.size > 2) throw new Error(`late", "  ${x}`); /* a", "note */ ok"];
    const [a, b, c, d] = highlight(lines, "app/x.ts");
    expect(inked(a ?? [])).toEqual(["kw:const", "kw:await", "fn:spendLimit", "com:// dollars"]);
    expect(inked(b ?? [])).toEqual(["kw:if", "prop:size", "num:2", "kw:throw", "kw:new", "fn:Error", "str:`late"]);
    expect(inked(c ?? [])).toEqual(["str:  ${x}`", "com:/* a"]);
    expect(inked(d ?? [])).toEqual(["com:note */"]);
    // Every line keeps all its text.
    expect(highlight(lines, "app/x.ts").map((l) => l.map((p) => p.text).join(""))).toEqual(lines);
  });
});
