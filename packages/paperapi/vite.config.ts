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
      // net and fs are service-only (Node's network and file modules): their own entries keep them out of pages
      entry: {
        index: path.resolve(import.meta.dirname, "src/index.ts"),
        net: path.resolve(import.meta.dirname, "src/net.ts"),
        fs: path.resolve(import.meta.dirname, "src/fs.ts"),
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
