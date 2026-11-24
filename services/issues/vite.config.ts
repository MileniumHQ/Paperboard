import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// The dashboard is served by the worker at /dashboard/, so its build lands
// in dist/dashboard and the worker's static assets serve dist as the root.
export default defineConfig({
    root: "src/dashboard",
    base: "/dashboard/",
    plugins: [solid()],
    build: {
        outDir: "../../dist/dashboard",
        emptyOutDir: true,
        target: "esnext",
    },
});
