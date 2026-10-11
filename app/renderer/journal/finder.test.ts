import { describe, expect, it } from "vitest";
import { journalOf } from "@gaia/world";
import { find, findablesOf } from "./finder.ts";

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
  const names = (query: string): string[] => find(items, query).map((f) => f.item.name);

  it("finds every folder, building or landmark, file and definition once, a file's own page by the file", () => {
    expect(items.map((f) => f.at).sort()).toEqual(
      ["app", "app/world-service", "packages", "packages/world", "entity:packages/world", FILE, "app/world-service/index.ts", "packages/world/journal.ts", `${FILE}#openWorld`, `${FILE}#OpenWorldOptions`, `${FILE}#OpenWorldOptions.root`, "packages/world/journal.ts#journalOf"].sort(),
    );
    // A definition inside another goes by the name that says where it is.
    expect(items.find((f) => f.at === `${FILE}#OpenWorldOptions.root`)).toMatchObject({ name: "OpenWorldOptions.root", where: FILE });
  });

  it("ranks letters in the name, at the start of words and run together, before letters strewn through a path", () => {
    // The letters at the start of each word of openWorld, before the longer name and the file.
    expect(names("ow")[0]).toBe("openWorld");
    expect(names("opwo")[0]).toBe("openWorld");
    expect(names("opwo").slice(1, 3).sort()).toEqual(["OpenWorldOptions", "open-world.ts"]);
    // The whole name wins outright: the folder world, then the names with world as a word of their own.
    expect(names("world")[0]).toBe("world");
    expect(names("world").slice(1, 3).sort()).toEqual(["@gaia/world", "world-service"]);
    // Every word must match, the name or the path: index.ts is found by its folder.
    expect(names("service index")).toEqual(["index.ts"]);
    expect(names("zzz")).toEqual([]);
    expect(names("  ")).toEqual([]);
  });

  it("marks which letters of the name matched", () => {
    expect(find(items, "jof")[0]).toMatchObject({ item: { name: "journalOf" }, letters: [0, 7, 8] });
  });
});
