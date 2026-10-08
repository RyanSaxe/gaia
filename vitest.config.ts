import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "app/**/*.test.ts", "tools/**/*.test.ts"],
    // V8's Maglev compiler in Node 26.7 (V8 14.6) sometimes gives freshly made objects another's numbers when the
    // garbage collector compacts the heap mid-loop, so the same code model now and then divides its land
    // differently. Under `node --stress-compaction` the land's division differs in 5 of 60 runs with Maglev and in
    // none of 120 without it. Remove this once Node ships a V8 that fixes it.
    execArgv: ["--no-maglev"],
  },
});
