// `import X from "./file.ts?worker"` returns a constructor for a worker that
// runs that file. Vite provides it for the app, and tools/lab-page.ts for the
// one-file lab.
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

// `import text from "./file.svg?raw"` returns the file's text. Vite provides it for the app, and tools/lab-page.ts for the
// one-file lab.
declare module "*?raw" {
  const text: string;
  export default text;
}

// `import url from "./picture.webp"` returns the image's URL. Vite serves it as a file for the app, and
// tools/lab-page.ts inlines it as a data URL for the one-file lab.
declare module "*.webp" {
  const url: string;
  export default url;
}

// `import url from "./face.woff2"` returns the font's URL. Vite serves it as a file for the app, and `pnpm brand`
// (tools/brand.ts) and tools/lab-page.ts inline it as a data URL.
declare module "*.woff2" {
  const url: string;
  export default url;
}

// `import url from "./wind.ogg"` returns the recording's URL. Vite serves it as a file for the app, and
// tools/lab-page.ts inlines it as a data URL for the one-file lab.
declare module "*.ogg" {
  const url: string;
  export default url;
}

// `import { facts, judged } from "virtual:proving-ground"` returns the proving ground's facts and its fixed judgments.
// tools/proving-ground.ts builds them from the plan in tools/proving.ts at build time, as a Vite plugin for the app
// and tests and an esbuild plugin for the one-file lab.
declare module "virtual:proving-ground" {
  import type { CodeFacts } from "@gaia/schema";
  import type { Judgments } from "@gaia/world";
  export const facts: CodeFacts;
  export const judged: Judgments;
}
