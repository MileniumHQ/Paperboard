import { resolve } from "node:path";

const paperuiRoot = resolve(__dirname, "../../packages/paperui");

// PaperUI's published entry is client-compiled, so both site builds resolve
// the library from source. The server and client must compile the same source
// so the CSS-module hashes and markup agree for hydration.
export const paperuiAlias = [
    {
        find: /^@paperboard-dev\/paperui\/style\.css$/,
        replacement: resolve(paperuiRoot, "src/styles/styles.css"),
    },
    {
        find: /^@paperboard-dev\/paperui$/,
        replacement: resolve(paperuiRoot, "src/index.ts"),
    },
];
