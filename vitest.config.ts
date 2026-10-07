import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "app/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
