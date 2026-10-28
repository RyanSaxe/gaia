// Builds the app's four bundles: the main process and the world service, which
// run in Node, the preload script, and the renderer.

import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { provingGroundVite } from "../tools/proving-ground.ts";

const here = import.meta.dirname;

export default defineConfig({
  main: {
    build: {
      // The world service runs the world package, so the build bundles Gaia's own packages instead of requiring them at
      // run time.
      externalizeDeps: { exclude: ["@gaia/schema", "@gaia/world", "@gaia/kinds", "@gaia/primitives", "@gaia/realize", "@gaia/render", "@gaia/terrain"] },
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
    // Builds the proving ground from its plan as the `virtual:proving-ground` module.
    plugins: [provingGroundVite()],
    build: {
      rollupOptions: { input: { index: resolve(here, "renderer/index.html") } },
    },
  },
});
