// The showcase's codebase: folio, a made-up static site generator whose
// world is composed for Gaia's film. A wood, a meadow, a village of houses
// on a brook, a hub's tower on a hill, and past it an old renderer gone to
// ruin.
//
// folio's source is real code, kept as one text file
// (`app/renderer/terrain/fixtures/showcase-code.txt`, each file under its
// `=== path ===` line), so Gaia's own world reads one file rather than a
// codebase of its own. Each part is written as well or as poorly as it
// fares: the old renderer in `v1/` is tangled, untested and full of emptied
// error handlers; the search index in `find/` has gone tired; the rest is
// kept. Folder names place each area on the land (a folder's place is seeded
// by its path), so they were chosen, from names a real project might use,
// for where they put the places the film walks.
//
// `--code DIR` writes folio's source to DIR, outside Gaia's repository or
// under node_modules, so Gaia's own world never reads it.
//
// Usage: pnpm showcase --code DIR

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { folioFiles } from "../app/renderer/terrain/showcase-code.ts";

const repo = resolve(import.meta.dirname, "..");
const args = parseArgs({ options: { code: { type: "string" } } }).values;
if (args.code === undefined) throw new Error("Name where to write folio's source: pnpm showcase --code DIR.");
const dir = resolve(args.code);
const inside = relative(repo, dir);
if (!inside.startsWith("..") && !inside.split("/").includes("node_modules")) throw new Error(`Write folio's code outside Gaia's repository or under node_modules, or Gaia's own world reads it: ${dir}.`);
const files = folioFiles(readFileSync(resolve(repo, "app/renderer/terrain/fixtures/showcase-code.txt"), "utf8"));
for (const [path, text] of files) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}
console.log(`showcase: wrote folio's ${files.size} files to ${dir}`);
