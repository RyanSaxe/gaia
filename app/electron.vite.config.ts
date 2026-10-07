// Builds the four parts of the app: the main process and the world service
// (both Node), the preload script, and the renderer (the lab).

import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const here = import.meta.dirname;

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(here, "main/index.ts"),
          "world-service": resolve(here, "world-service/index.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(here, "preload/index.ts") },
        // Sandboxed preload scripts must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(here, "renderer"),
    build: {
      rollupOptions: { input: { index: resolve(here, "renderer/index.html") } },
    },
  },
});
