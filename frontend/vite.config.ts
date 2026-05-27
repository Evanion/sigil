/// <reference types="vitest" />
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

// Tauri sets TAURI_DEV_HOST when serving the dev server to a mobile device
// or another network host. When unset, leave host as `false` so Vite binds to
// localhost only (default).
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solidPlugin()],
  // Tauri prints sidecar/cargo status to the terminal; let it remain visible.
  clearScreen: false,
  server: {
    port: 5173,
    // The Tauri shell hard-codes devUrl=http://localhost:5173 — fail fast
    // if the port is already taken instead of silently shifting to 5174.
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: {
      // Don't reload the SPA when Rust files change under src-tauri/.
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/graphql": {
        target: "http://localhost:4680",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
