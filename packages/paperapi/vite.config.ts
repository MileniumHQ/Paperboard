import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      // net is service-only (Node's network modules): its own entry keeps it out of pages
      entry: {
        index: path.resolve(import.meta.dirname, "src/index.ts"),
        net: path.resolve(import.meta.dirname, "src/net.ts"),
      },
      fileName: (format, entry) => `${entry === "index" ? "paperapi" : entry}.${format === "es" ? "es.js" : "cjs"}`,
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["electron", /^node:/],
      output: {
        globals: {
          electron: "electron",
        },
      },
    },
  },
});
