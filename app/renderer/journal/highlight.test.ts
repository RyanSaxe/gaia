import { describe, expect, it } from "vitest";
import { highlight } from "./highlight.ts";

const lineText = (parts: readonly { readonly text: string }[]): string =>
  parts.map((p) => p.text).join("");

describe("code on a page", () => {
  it("keeps every character of every line as written, a comment or string over several lines included", () => {
    const lines = [
      "const limit = await spendLimit(engine); // dollars",
      "if (x.size > 2) throw new Error(`late",
      "  ${x}`); /* a",
      "note */ ok",
    ];
    for (const path of ["app/x.ts", "tools/a.py", "engine/src/a.rs"]) {
      expect(highlight(lines, path).map(lineText), path).toEqual(lines);
    }
  });
});
