// `import X from "./file.ts?worker"` gives a constructor for a worker running
// that file: Vite does this for the app, and tools/lab-page.ts for the one-file lab.
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

// `import text from "./file.svg?raw"` gives the file's text: Vite does this for the app, and tools/lab-page.ts for the one-file lab.
declare module "*?raw" {
  const text: string;
  export default text;
}

// `import url from "./picture.webp"` gives the picture's address: a file Vite serves for the app, and a data URL
// tools/lab-page.ts inlines for the one-file lab.
declare module "*.webp" {
  const url: string;
  export default url;
}

// `import url from "./face.woff2"` gives the font file's address, as a picture's does: a file Vite serves for the app,
// and a data URL `pnpm brand` (tools/brand.ts) and tools/lab-page.ts inline.
declare module "*.woff2" {
  const url: string;
  export default url;
}

// `import url from "./wind.ogg"` gives the recording's address, as a picture's does: a file Vite serves for the app,
// and a data URL tools/lab-page.ts inlines for the one-file lab.
declare module "*.ogg" {
  const url: string;
  export default url;
}

// `import { facts, judged } from "virtual:proving-ground"` gives the proving ground: the facts its world is laid out
// from and the choices fixed for it, made from the plan in tools/proving.ts as the page is built, by Vite's plugin for
// the app and the tests and esbuild's for the one-file lab (tools/proving-ground.ts).
declare module "virtual:proving-ground" {
  import type { CodeFacts } from "@gaia/schema";
  import type { Judgments } from "@gaia/world";
  export const facts: CodeFacts;
  export const judged: Judgments;
}
