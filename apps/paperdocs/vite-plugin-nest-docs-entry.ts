import type { Plugin } from "vite";

// The Cloudflare Worker serves the landing from the dist root and mounts the
// docs SPA under /docs. Vite emits the docs HTML entry at the output root
// because the source entry must stay at the project root for the dev server,
// so this relocates only the emitted file to docs/index.html. Relocating the
// entry, rather than adding a landing index at a different name, is what keeps
// the generated docs HTML from overwriting the landing's static index.html.
export function nestDocsEntry(): Plugin {
    return {
        name: "paperdocs-nest-docs-entry",
        apply: "build",
        enforce: "post",
        generateBundle(_options, bundle) {
            const entry = bundle["index.html"];
            if (!entry) {
                this.error(
                    "paperdocs: expected Vite to emit index.html for the docs entry",
                );
                return;
            }
            delete bundle["index.html"];
            entry.fileName = "docs/index.html";
            bundle["docs/index.html"] = entry;
        },
    };
}
