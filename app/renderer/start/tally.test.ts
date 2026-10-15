import { describe, expect, it } from "vitest";
import { TALLY_MOST, tallyWords } from "./tally.ts";

describe("the tally on a known world's card", () => {
  it("says how many commits since the person last opened the world, in words while the strokes count them", () => {
    expect(tallyWords(1)).toEqual(["one commit", "since you last opened it"]);
    expect(tallyWords(14)).toEqual(["fourteen commits", "since you last opened it"]);
    expect(tallyWords(21)).toEqual(["twenty-one commits", "since you last opened it"]);
    expect(tallyWords(TALLY_MOST)).toEqual(["thirty commits", "since you last opened it"]);
  });

  it("writes the number in figures past what the strokes count", () => {
    expect(tallyWords(1412)).toEqual(["1,412 commits", "since you last opened it"]);
  });

  it("says only that the code changed when the commit last opened is no longer in the history", () => {
    expect(tallyWords(null)).toEqual(["the code has changed", "since you last opened it"]);
  });
});
