/// <reference types="vitest" />
import { resolve } from "node:path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
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
