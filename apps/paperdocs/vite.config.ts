import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { docsSearchPlugin } from "./vite-plugin-docs-search";
import { nestDocsEntry } from "./vite-plugin-nest-docs-entry";

// The docs SPA is served from the /docs path prefix. This is the single knob:
// change it to "/" to host the docs at the site root. import.meta.env.BASE_URL
// derives from it, and src/utils/base.ts is the only place that joins it onto
// links/assets. The landing is plain static files in public/, registered with
// the Worker's ASSETS binding at the dist root.
export default defineConfig({
    base: "/docs/",
    plugins: [docsSearchPlugin(), nestDocsEntry(), solid()],
});
