import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    // relative asset URLs: a host may serve the panel from a folder
    base: "./",
    plugins: [solidPlugin()],
    resolve: {
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
    build: {
        // the panel page and Home's widget page, built side by side
        rollupOptions: {
            input: {
                index: "index.html",
                widget: "widget.html",
            },
        },
    },
});
