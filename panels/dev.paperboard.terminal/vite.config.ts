import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [
        solidPlugin({
            extensions: [".js", ".ts", ".jsx", ".tsx"],
        }),
    ],
    resolve: {
        preserveSymlinks: true,
        conditions: ["solid", "browser", "import", "default"],
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
    build: {
        target: "esnext",
        ssr: false,
    },
});
