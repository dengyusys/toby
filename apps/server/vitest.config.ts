import { defineConfig } from "vitest/config";

// Plain vitest transform: the server is plain TypeScript (no decorators),
// so nothing special is needed to match the tsc build.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
