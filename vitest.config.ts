import { defineConfig } from "vitest/config";

// Root HTTP integration tests: contract checks against a real server process.
// 根 HTTP 集成测试:对真实服务端进程做契约检查。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
