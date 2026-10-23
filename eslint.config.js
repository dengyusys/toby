import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Toby vertical-domain boundary discipline (docs/decisions/vertical-domains.md).
// Rules are generated from the whitelist tables below, so a boundary violation
// is a lint error, never a review-memory requirement.
// Toby 垂直域边界纪律(见 docs/decisions/vertical-domains.md)。规则由下方白名单
// 数据驱动生成,边界违规即 lint error,不依赖 review 记忆。

// Domains each domain may depend on. Register a row when a domain lands and the
// import-boundary rules regenerate automatically.
// 各域允许依赖的其他业务域。新域落地时在此登记一行,导入边界规则自动生成。
const DOMAIN_ALLOWED = {
  system: [],
  ledger: [],
  auth: [],
};

// A domain's types.ts stays pure: no transport, no infrastructure, no node: APIs.
// 域内 types.ts 保持纯净:零传输、零基础设施、零 node: 依赖。
const PURE_TYPES = {
  regex: "(fastify|@fastify|infrastructure|node:)",
  message:
    "domain types.ts must stay pure: no fastify, infrastructure or node: imports",
};

// Domains never reach into HTTP assembly internals (the Nest app
// factory, static assets). The shared contract, response writer and
// guard-fn type stay importable — domains build routes against them.
// 域内不得导入 HTTP 装配内部模块(Nest 应用工厂、静态资源);
// 共享契约、响应写出与守卫函数类型可导入——域路由依据它们构建。
const ASSEMBLY = {
  regex: "infrastructure/http/(nest-app|static-assets)",
  message:
    "domains must not import HTTP assembly internals (assembly lives in main.ts and domain module.ts files)",
};

// Infrastructure never imports business domains: assembly happens only in the
// composition root and each domain's module.ts.
// 基础设施不得导入业务域:装配只发生在组合根与各域 module.ts。
const NO_DOMAIN_IMPORTS = {
  regex: "domains/",
  message:
    "infrastructure must not import domains (assembly lives in main.ts and domain module.ts files)",
};

// Web apps never import the server package; packages never import apps.
// Dependency direction is always apps -> packages.
// Web 应用不导入服务端;packages 不导入 apps。依赖方向恒为 apps -> packages。
const NO_SERVER_IMPORT = {
  group: ["@toby/server", "@toby/server/*", "@toby/server/**"],
  message: "web apps and packages never import @toby/server",
};

const NO_APPS_IMPORT = {
  group: [
    "**/apps/*",
    "**/apps/**",
    "@toby/web",
    "@toby/web/*",
    "@toby/web/**",
    "@toby/web-mobile",
    "@toby/web-mobile/*",
    "@toby/web-mobile/**",
  ],
  message:
    "packages never import apps (dependency direction is apps -> packages)",
};

// Each domain's boundary, in both relative-path and domains/ prefix forms.
// Exceptions: self, whitelisted domains, infrastructure, and parent escapes
// (../..) which are already covered by the apps-level rules.
// 每个域的导入边界,相对路径与 domains/ 前缀两种写法都约束。
// 例外 = 自身、白名单内的域、infrastructure 与上跳父目录(../..)。
function domainBoundary(domain) {
  const allowed = [domain, ...DOMAIN_ALLOWED[domain]];
  const relativeExceptions = [
    ...allowed.map((target) => `${target}/`),
    "\\.\\.",
    "infrastructure",
    "utils",
  ].join("|");
  const prefixExceptions = [...allowed.map((target) => `${target}/`), "$"].join(
    "|",
  );
  const list = DOMAIN_ALLOWED[domain];
  return {
    regex: `((?<!\\.)\\.\\./(?!${relativeExceptions})|domains/(?!${prefixExceptions}))`,
    message: list.length
      ? `the ${domain} domain may only depend on: ${list.join(", ")}`
      : `the ${domain} domain must not depend on other business domains`,
  };
}

const forbid = (files, patterns) => ({
  files,
  rules: {
    "no-restricted-imports": ["error", { patterns }],
  },
});

// One boundary entry pair per domain: whole-domain rules plus the pure
// types.ts overlay. Later flat-config entries override earlier ones entirely,
// so the narrow types.ts entry repeats the wide entry's patterns.
// 每个域两条:全域装配禁令与域边界,域内 types.ts 再叠加纯净约束。
// flat config 后配置对象整体覆盖前面对象,窄条目须为宽条目超集。
const domainRuleEntries = Object.keys(DOMAIN_ALLOWED).flatMap((domain) => {
  const dir = `apps/server/src/domains/${domain}`;
  const boundary = domainBoundary(domain);
  return [
    forbid([`${dir}/**/*.ts`], [ASSEMBLY, boundary]),
    forbid([`${dir}/types.ts`], [ASSEMBLY, boundary, PURE_TYPES]),
  ];
});

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "data/**",
      "**/.git/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // PC web app (docs/decisions/web-split-dual-apps.md): sharing with the mobile
  // app goes only through @toby/contract (pure logic); components and styles
  // are owned by each app and never shared.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/web-mobile/*",
                "**/web-mobile/**",
                "@toby/web-mobile/*",
                "@toby/web-mobile/**",
              ],
              message:
                "web and web-mobile never import each other; share via @toby/contract",
            },
            NO_SERVER_IMPORT,
          ],
        },
      ],
    },
  },
  // Mobile web app: mirror of the PC app's rules.
  // 移动端 Web 应用:与 PC 端规则互为镜像。
  {
    files: ["apps/web-mobile/**/*.{ts,tsx}"],
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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/web/*", "**/web/**", "@toby/web/*", "@toby/web/**"],
              message:
                "web-mobile and web never import each other; share via @toby/contract",
            },
            NO_SERVER_IMPORT,
          ],
        },
      ],
    },
  },
  // @toby/contract: pure TypeScript, zero JSX, fetch-based. No React, no UI kit.
  // @toby/contract:纯 TS、零 JSX、基于 fetch。不引 React 与组件库。
  {
    files: ["packages/contract/src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/*", "react-dom", "react-dom/*"],
              message:
                "@toby/contract is pure logic: no React and no UI-kit imports",
            },
            NO_SERVER_IMPORT,
            NO_APPS_IMPORT,
          ],
        },
      ],
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
  ...domainRuleEntries,
  // No exceptions: infrastructure has zero imports from business domains.
  // 无例外:基础设施对业务域零导入。
  forbid(["apps/server/src/infrastructure/**/*.ts"], [NO_DOMAIN_IMPORTS]),
  // utils stays a leaf: shared low-level helpers never reach back into
  // domains or infrastructure.
  // utils 保持叶子:共享底层助手不回导入域或基础设施。
  forbid(
    ["apps/server/src/utils/**/*.ts"],
    [
      {
        regex: "(domains/|infrastructure/)",
        message:
          "utils stays a leaf: no domain or infrastructure imports (they import utils, never the other way)",
      },
    ],
  ),
  eslintConfigPrettier,
);
