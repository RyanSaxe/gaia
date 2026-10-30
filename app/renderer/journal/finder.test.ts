import { describe, expect, it } from "vitest";
import { journalOf } from "@gaia/world";
import { findablesOf } from "./finder.ts";

const FILE = "app/world-service/open-world.ts";
const world = {
  name: "demo",
  areas: [
    { path: "", name: "demo", parent: null },
    { path: "app", name: "app", parent: "" },
    { path: "app/world-service", name: "world-service", parent: "app" },
    { path: "packages", name: "packages", parent: "" },
    { path: "packages/world", name: "world", parent: "packages" },
  ],
  patches: [
    { path: FILE, name: "open-world.ts", area: "app/world-service" },
    { path: "app/world-service/index.ts", name: "index.ts", area: "app/world-service" },
    { path: "packages/world/journal.ts", name: "journal.ts", area: "packages/world" },
  ],
  symbols: [
    { id: `${FILE}#openWorld`, file: FILE, name: "openWorld", line: 58, lines: 104 },
    { id: `${FILE}#OpenWorldOptions`, file: FILE, name: "OpenWorldOptions", line: 48, lines: 7 },
    { id: `${FILE}#OpenWorldOptions.root`, file: FILE, parent: `${FILE}#OpenWorldOptions`, name: "root", line: 50, lines: 1 },
    { id: "packages/world/journal.ts#journalOf", file: "packages/world/journal.ts", name: "journalOf", line: 90, lines: 60 },
  ],
  things: [{ path: "packages/world", name: "@gaia/world" }],
};

describe("the finder", () => {
  const items = findablesOf(journalOf(world));

  it("finds every folder, building or landmark, file and definition once, a file's own page by the file", () => {
    expect(items.map((f) => f.at).sort()).toEqual(
      ["app", "app/world-service", "packages", "packages/world", "entity:packages/world", FILE, "app/world-service/index.ts", "packages/world/journal.ts", `${FILE}#openWorld`, `${FILE}#OpenWorldOptions`, `${FILE}#OpenWorldOptions.root`, "packages/world/journal.ts#journalOf"].sort(),
    );
  });
});
