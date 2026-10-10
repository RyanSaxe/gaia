// The lab (the app's renderer) as ONE self-contained HTML page: esbuild
// bundles app/renderer/main.ts, and the app's own index.html carries the JS
// and CSS inline. `pnpm lab:html` writes the page to a file; `pnpm lab:serve`
// rebuilds it on every change and serves it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BuildOptions, type BuildResult, type Plugin, build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const renderer = resolve(root, "app/renderer");

const SCRIPT = { bundle: true, format: "iife", minify: true, write: false, target: "es2022", tsconfig: resolve(root, "tsconfig.json"), legalComments: "none" } as const;

/**
 * `import X from "./file.ts?worker"`, as Vite reads it for the app: the file
 * bundled on its own and run as a worker. The one-file lab carries the
 * worker's script inline and starts it from a blob URL.
 */
const inlineWorkers: Plugin = {
  name: "inline-workers",
  setup(b) {
    b.onResolve({ filter: /\?worker$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.replace(/\?worker$/, "")), namespace: "inline-worker" }));
    b.onLoad({ filter: /.*/, namespace: "inline-worker" }, async (args) => {
      const result = await build({ ...SCRIPT, entryPoints: [args.path], metafile: true });
      const code = result.outputFiles[0]?.text ?? "";
      return {
        loader: "js",
        contents: `const url = URL.createObjectURL(new Blob([${JSON.stringify(code)}], { type: "text/javascript" }));\nexport default class { constructor() { return new Worker(url); } }`,
        watchFiles: Object.keys(result.metafile.inputs).map((f) => resolve(process.cwd(), f)),
      };
    });
  },
};

/** `import text from "./file.svg?raw"`, as Vite reads it for the app: the file's text as a string. */
const rawText: Plugin = {
  name: "raw-text",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "raw-text" }));
    b.onLoad({ filter: /.*/, namespace: "raw-text" }, (args) => ({ loader: "text", contents: readFileSync(args.path, "utf8"), watchFiles: [args.path] }));
  },
};

export const LAB_BUILD = {
  ...SCRIPT,
  entryPoints: [resolve(renderer, "main.ts")],
  outdir: "lab",
  plugins: [inlineWorkers, rawText],
  // Pictures (Gaia's logo, the start's preview) go inline, so the page stays one file.
  loader: { ".webp": "dataurl" },
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
