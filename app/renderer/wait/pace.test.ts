import { describe, expect, it } from "vitest";
import { pacer } from "./pace.ts";

describe("the wait's pace", () => {
  it("never draws anything before it has happened", () => {
    const p = pacer<string>({ everyMs: 100, spreadMs: [1000, 5000] });
    expect(p.due(1000)).toEqual([]);
    p.add(["a"], 2000);
    expect(p.due(1999)).toEqual([]);
    expect(p.due(2000)).toEqual(["a"]);
  });
});
