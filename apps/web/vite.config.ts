/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// PC web app: dev server on 8630, /api proxied to the Toby server on 8629.
// PC 端 Web 应用:开发服务器 8630,/api 代理到 8629 的 Toby 服务端。
export default defineConfig({
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
    port: 8630,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8629",
    },
  },
  test: {
    environment: "happy-dom",
  },
});
