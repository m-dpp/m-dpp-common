import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Library build (optional). In development a consuming app imports `src/index.ts`
// directly through the package `exports`, so no build step is needed — Vite in the
// consumer compiles this source and hot-reloads it. `npm run build` produces `dist/`
// for a distributable artifact when one is wanted.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "MdppUi",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
    cssCodeSplit: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
