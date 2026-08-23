import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    test: {
        environment: "jsdom",
        globals: true,
        transformMode: {
            web: [/\.[jt]sx?$/],
        },
        deps: {
            optimizer: {
                web: {
                    include: ["solid-js"],
                },
            },
        },
        isolate: true,
    },
    resolve: {
        conditions: ["development", "browser"],
    },
});
