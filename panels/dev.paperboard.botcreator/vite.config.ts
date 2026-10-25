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
        rollupOptions: {
            // the panel page and the Home widget page, built side by side
            input: { index: "index.html", widget: "widget.html" },
        },
    },
});
