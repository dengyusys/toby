import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Server tests run through swc so decorator metadata (design:paramtypes)
// is emitted the same way the tsc build does — constructor injection and
// @nestjs/testing resolve identically under test and in production.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
