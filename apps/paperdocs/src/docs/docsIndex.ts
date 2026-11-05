import sections from "./sections.json";
import paperboard from "./paperboard/pages.json";
import developers from "./developers/pages.json";
import paperapi from "./paperapi/pages.json";
import paperui from "./paperui/pages.json";

// The docs index: section metadata in sections.json, and each section's page
// list in <section>/pages.json, so a writer working in one section never edits
// a file another section depends on. Plain JSON imports, no Vite-only APIs:
// the prerender script and tests read it too. vite-plugin-docs-search.ts reads
// the same files from disk; a new section is added in both places.
export const docsIndex: Record<string, any> = {
    meta: { sections },
    paperboard,
    developers,
    paperapi,
    paperui,
};
