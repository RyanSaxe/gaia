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

// `import url from "./face.woff2"` gives the font file's address, as a picture's does: only `pnpm brand` (tools/brand.ts)
// imports one, and inlines it as a data URL.
declare module "*.woff2" {
  const url: string;
  export default url;
}
