import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Lint owns code quality only (syntax, hooks rules, formatting interplay).
// Import boundaries — vertical domains, dependency direction — are enforced
// by the plain-TypeScript suite in test/boundaries.test.ts.
// ESLint 只负责代码质量(语法、hooks 规则、格式协同)。
// 导入边界——垂直域与依赖方向——由 test/boundaries.test.ts 以普通 TypeScript 强制。

// Shared block for the two React SPAs (docs/decisions/web-split-dual-apps.md).
// 两个 React SPA 共用的规则块(见 docs/decisions/web-split-dual-apps.md)。
const reactApp = (appDir) => ({
  files: [`${appDir}/**/*.{ts,tsx}`],
  languageOptions: {
    globals: { ...globals.browser },
  },
  plugins: {
    "react-hooks": reactHooks,
    "react-refresh": reactRefresh,
  },
  rules: {
    ...reactHooks.configs.recommended.rules,
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
  },
});

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "data/**",
      "**/.git/**",
      // Third-party agent skills installed into the workspace (not our code).
      // 安装进仓库的第三方 agent skill(非本项目代码)。
      ".agents/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactApp("apps/web"),
  reactApp("apps/web-mobile"),
  // @toby/contract: pure TypeScript, zero JSX, fetch-based. No React, no UI kit.
  // @toby/contract:纯 TS、零 JSX、基于 fetch。不引 React 与组件库。
  {
    files: ["packages/contract/src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  // Node-side code: the server app, root tests, orchestration scripts and the
  // flat-config files themselves.
  // Node 侧代码:服务端、根测试、编排脚本与配置文件本身。
  {
    files: [
      "apps/server/**/*.{ts,js}",
      "test/**/*.ts",
      "scripts/**/*.{js,ts}",
      "*.config.{js,ts}",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  eslintConfigPrettier,
);
