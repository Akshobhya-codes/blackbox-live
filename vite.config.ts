import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds the dashboard into public/, which the Express server already hosts.
// Single origin keeps the SSE stream simple — no proxy, no CORS.
export default defineConfig({
  root: "ui",
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true, ws: true },
    },
  },
});
