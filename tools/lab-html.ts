// Bundles the renderer and frozen world fixtures into one offline HTML page.
// It has no engine connection and uses saved Jev answers.
// Usage: pnpm lab:html [out.html]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { LAB_BUILD, labBundle, labPage } from "./lab-page.ts";

const out = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../dist/lab.html"));
const html = labPage(labBundle(await build(LAB_BUILD)));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} ${(html.length / 1024).toFixed(0)} KiB`);
