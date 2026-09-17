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
      entry: path.resolve(import.meta.dirname, "src/index.ts"),
      name: "paperapi",
      fileName: (format) => format === "es" ? "paperapi.es.js" : "paperapi.cjs",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["electron"],
      output: {
        globals: {
          electron: "electron",
        },
      },
    },
  },
});
