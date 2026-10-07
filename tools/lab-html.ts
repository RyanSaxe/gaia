// Bundles the lab (the app's renderer) into ONE self-contained HTML file for
// pair pages: inline JS and CSS, no network requests. Outside the app there
// is no engine, so its status bar reads "No engine (standalone)".
// Usage: pnpm lab:html [out.html]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const renderer = resolve(root, "app/renderer");
const out = resolve(process.argv[2] ?? resolve(root, "dist/lab.html"));

const result = await build({
  entryPoints: [resolve(renderer, "main.ts")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  outdir: "lab",
  target: "es2022",
  tsconfig: resolve(root, "tsconfig.json"),
  legalComments: "none",
});
const output = (ext: string): string => {
  const file = result.outputFiles.find((f) => f.path.endsWith(ext));
  if (file === undefined) throw new Error(`esbuild produced no ${ext} file.`);
  return file.text;
};
const js = output(".js").replace(/<\/script/gi, "<\\/script");
const css = output(".css");

// The app's own page, with the module script swapped for the inline bundle.
// The page's CSP allows only 'self', which an inline bundle is not.
const page = readFileSync(resolve(renderer, "index.html"), "utf8");
const csp = /<meta http-equiv="Content-Security-Policy"[^>]*>\n/;
const entry = '<script type="module" src="./main.ts"></script>';
if (!csp.test(page) || !page.includes(entry)) throw new Error("app/renderer/index.html changed shape; update tools/lab-html.ts.");
const html = page
  .replace(csp, "")
  .replace("</head>", () => `<style>${css}</style>\n</head>`)
  .replace(entry, () => `<script>${js}</script>`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} ${(html.length / 1024).toFixed(0)} KiB`);
