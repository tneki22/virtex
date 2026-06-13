import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "client",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4173",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["../tests/setup.ts"],
    include: ["../tests/**/*.test.ts", "../tests/**/*.test.tsx"],
  },
});
