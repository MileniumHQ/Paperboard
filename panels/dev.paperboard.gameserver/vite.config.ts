import { resolve } from "node:path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    resolve: {
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
    build: {
        rollupOptions: {
            // the panel, and widget.html beside it for Home's widgets
            input: {
                index: resolve(import.meta.dirname, "index.html"),
                widget: resolve(import.meta.dirname, "widget.html"),
            },
        },
    },
});
