// Bundles the lab (the app's renderer) into ONE self-contained HTML file for
// pair pages: inline JS and CSS, no network requests. Outside the app there
// is no engine, so its status bar reads "No engine (standalone)".
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
