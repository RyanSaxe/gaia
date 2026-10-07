// The lab (the app's renderer) as ONE self-contained HTML page: esbuild
// bundles app/renderer/main.ts, and the app's own index.html carries the JS
// and CSS inline. `pnpm lab:html` writes the page to a file; `pnpm lab:serve`
// rebuilds it on every change and serves it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BuildOptions, BuildResult } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const renderer = resolve(root, "app/renderer");

export const LAB_BUILD = {
  entryPoints: [resolve(renderer, "main.ts")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  outdir: "lab",
  target: "es2022",
  tsconfig: resolve(root, "tsconfig.json"),
  legalComments: "none",
} as const satisfies BuildOptions;

export interface LabBundle {
  readonly js: string;
  readonly css: string;
}

export function labBundle(result: Pick<BuildResult, "outputFiles">): LabBundle {
  const output = (ext: string): string => {
    const file = result.outputFiles?.find((f) => f.path.endsWith(ext));
    if (file === undefined) throw new Error(`esbuild produced no ${ext} file.`);
    return file.text;
  };
  return { js: output(".js").replace(/<\/script/gi, "<\\/script"), css: output(".css") };
}

/**
 * The app's own page, with the module script swapped for the inline bundle.
 * It reads index.html on every call, so a served page picks up edits to it.
 */
export function labPage(bundle: LabBundle): string {
  const page = readFileSync(resolve(renderer, "index.html"), "utf8");
  // The page's CSP allows only 'self', which an inline bundle is not.
  const csp = /<meta http-equiv="Content-Security-Policy"[^>]*>\n/;
  const entry = '<script type="module" src="./main.ts"></script>';
  if (!csp.test(page) || !page.includes(entry)) throw new Error("app/renderer/index.html changed shape; update tools/lab-page.ts.");
  return page
    .replace(csp, "")
    .replace("</head>", () => `<style>${bundle.css}</style>\n</head>`)
    .replace(entry, () => `<script>${bundle.js}</script>`);
}
