import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    resolve: {
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
    build: {
        // the panel page and the Home widget page ship side by side in dist/
        rollupOptions: {
            input: {
                index: "index.html",
                widget: "widget.html",
            },
        },
    },
});
