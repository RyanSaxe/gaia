import { defineConfig } from "vitest/config";
import { provingGroundVite } from "./tools/proving-ground.ts";

export default defineConfig({
  // The proving ground, generated from its plan once per run (`virtual:proving-ground`).
  plugins: [provingGroundVite()],
  test: {
    include: ["packages/*/test/**/*.test.ts", "app/**/*.test.ts", "tools/**/*.test.ts"],
    // V8's Maglev compiler in Node 26.7 (V8 14.6) sometimes gives newly created objects another object's numbers when
    // the garbage collector compacts the heap mid-loop, so the same facts occasionally divide their land
    // differently. Under `node --stress-compaction` the land's division differs in 5 of 60 runs with Maglev and in
    // none of 120 without it. Remove this once Node ships a V8 that fixes it.
    execArgv: ["--no-maglev"],
  },
});
