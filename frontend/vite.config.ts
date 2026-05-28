/// <reference types="vitest" />
import { resolve } from "node:path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

// Tauri exposes its dev-host on this env var (set by `tauri dev` when targeting
// a mobile device on the same LAN). When unset, Vite binds only to localhost.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solidPlugin()],
  // Tauri owns the terminal during `tauri dev`; let its output stay visible.
  clearScreen: false,
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken — Tauri's webview is hard-coded to it.
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    // Don't restart Vite when Rust source under src-tauri/ changes;
    // `tauri dev` owns those rebuilds.
    watch: { ignored: ["**/src-tauri/**"] },
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
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        welcome: resolve(__dirname, "src/welcome/welcome.html"),
      },
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
