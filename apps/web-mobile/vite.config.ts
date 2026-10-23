/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Mobile web app: base /m/ (the server serves its build at /m/), dev server
// on 8631, /api proxied to the Toby server (TOBY_PORT, default 8629).
// 移动端 Web 应用:base /m/(服务端在 /m/ 提供构建产物),开发服务器 8631,
// /api 代理到 Toby 服务端(TOBY_PORT,默认 8629)。
export default defineConfig({
  base: "/m/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Shadcn alias (components.json): "@/..." lands in src/, mirrored by
      // the tsconfig paths so the CLI resolves them at typecheck time too.
      // shadcn 别名(components.json):"@/..." 落在 src/,tsconfig 的 paths
      // 与之对应,CLI 在类型检查时同样可解析。
      "@": "/src",
    },
  },
  server: {
    port: 8631,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${process.env.TOBY_PORT ?? "8629"}`,
    },
  },
  test: {
    environment: "happy-dom",
  },
});
