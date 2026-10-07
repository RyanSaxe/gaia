// `import X from "./file.ts?worker"` gives a constructor for a worker running
// that file: Vite does this for the app, and tools/lab-page.ts for the one-file lab.
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
