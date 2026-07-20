import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    host: true,
    fs: {
      // shared/ fica um nível acima do client — precisa estar na allow list
      allow: [path.resolve(__dirname, "..")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
