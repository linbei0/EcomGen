import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // CORS 兜底（契约缺口 13.8）：联调若跨域失败，设 VITE_API_BASE_URL=/api/v1 走此代理，不改后端
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      // 相对 VITE_API_BASE_URL=/api/v1 时，/health 同样需要代理到 API 根路径
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  build: { sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // 测试钉死绝对地址：本机 apps/web/.env 若设了相对 base（走代理），
    // 会让 jsdom 的 fetch 收到相对 URL 而崩溃，测试必须与本地环境文件无关
    env: {
      VITE_API_BASE_URL: "http://127.0.0.1:8787/api/v1",
    },
  },
});
