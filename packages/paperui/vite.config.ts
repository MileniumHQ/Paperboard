import { defineConfig, type Plugin } from "vite";
import solidPlugin from "vite-plugin-solid";
import dts from "vite-plugin-dts";
import path from "path";
import { readFileSync } from "fs";

// three's DRACOLoader and KTX2Loader find their decoders (WebAssembly and
// JavaScript, megabytes) with `new URL("../libs/...", import.meta.url)`,
// which library mode would inline into their chunks as base64. Marked
// ?no-inline, they ship as files beside the build instead, fetched only by
// a model that needs them. A three upgrade that writes those lines another
// way fails the build here rather than shipping them inlined.
function threeDecoders(): Plugin {
    const loader = /\/three\/examples\/jsm\/loaders\/(DRACO|KTX2)Loader\.js$/;
    const reference = /new URL\( '(\.\.\/libs\/[^'?]+)', import\.meta\.url \)/g;
    return {
        name: "paperui:three-decoders",
        enforce: "pre",
        transform(code, id) {
            if (!loader.test(id)) return;
            let found = 0;
            const out = code.replace(reference, (_, file: string) => {
                found++;
                return `new URL( '${file}?no-inline', import.meta.url )`;
            });
            if (!found || found !== code.split("import.meta.url").length - 1) {
                this.error(`${id} no longer finds its decoders only with new URL( '../libs/...', import.meta.url ): update the threeDecoders plugin`);
            }
            return { code: out, map: null };
        },
    };
}

// pdf.js, its fonts and three ship inside the build: their licenses go with them
function thirdPartyLicenses(): Plugin {
    const licenses: Record<string, string> = {
        "pdfjs/LICENSE": "pdfjs-dist/LICENSE",
        "pdfjs/LICENSE_FOXIT": "pdfjs-dist/standard_fonts/LICENSE_FOXIT",
        "pdfjs/LICENSE_LIBERATION": "pdfjs-dist/standard_fonts/LICENSE_LIBERATION",
        "three/LICENSE": "three/LICENSE",
    };
    return {
        name: "paperui:third-party-licenses",
        generateBundle() {
            for (const [fileName, from] of Object.entries(licenses)) {
                this.emitFile({ type: "asset", fileName, source: readFileSync(path.resolve(import.meta.dirname, "node_modules", from)) });
            }
        },
    };
}

export default defineConfig({
    // Relative asset URLs: paperui.css is consumed from node_modules into
    // apps served under subpaths (/docs/) and custom protocols
    // (Electron) — root-absolute font URLs would 404 everywhere but /.
    base: "./",
    plugins: [
        solidPlugin(),
        threeDecoders(),
        thirdPartyLicenses(),
        dts({
            insertTypesEntry: true,
            tsconfigPath: "./tsconfig.json",
            rollupTypes: true,
            // tests are dev-only: their types and assets must never ship
            // inside the published package
            exclude: ["src/__tests__", "**/*.test.*"],
        }),
    ],
    build: {
        target: "esnext",
        cssCodeSplit: false,
        // NOTE: library mode unconditionally base64-inlines assets
        // (Vite checks build.lib before assetsInlineLimit, so setting it
        // does nothing). Fonts opt out per-URL with ?no-inline in
        // src/styles/fonts.css — do not remove those markers.
        lib: {
            // headless is the part that loads without a page (no component,
            // no CSS); the modules both entries share land in one chunk, so
            // each is one instance whichever entry imported it
            entry: {
                index: path.resolve(import.meta.dirname, "src/index.ts"),
                headless: path.resolve(import.meta.dirname, "src/headless.ts"),
            },
            fileName: (format, entry) => `${entry === "index" ? "paperui" : entry}.${format === "es" ? "es.js" : "cjs"}`,
            formats: ["es", "cjs"],
        },
        rollupOptions: {
            external: [
                "solid-js",
                "solid-js/web",
                "solid-js/store",
                "solid-transition-group",
            ],
            output: {
                exports: "named",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css" || assetInfo.name?.endsWith(".css")) {
                        return "paperui.css";
                    }
                    // three's decoders, by themselves: two Draco builds share file names
                    if (assetInfo.originalFileNames.some((file) => file.includes("three/examples/jsm/libs/"))) {
                        return "three/[name]-[hash][extname]";
                    }
                    // pdf.js's data files (character maps, fonts, image
                    // decoders; see PaperPdf) keep a folder of their own
                    if (assetInfo.originalFileNames.some((file) => file.includes("/pdfjs-dist/"))) {
                        return "pdfjs/[name][extname]";
                    }
                    return assetInfo.name || "";
                },
                globals: {
                    "solid-js": "Solid",
                    "solid-js/web": "SolidWeb",
                    "solid-js/store": "SolidStore",
                },
            },
        },
    },
});
