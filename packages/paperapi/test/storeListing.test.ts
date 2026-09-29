// The store listing parser is shared by the publisher, Origami's publish
// boundary and the library renderer: strict on the manifest form, lenient
// (drop, never throw) on the published form a page renders.
import { describe, expect, test } from "bun:test";
import {
    isDataImage,
    loadInstalledPanelMedia,
    parseStoreListing,
    parseStoreManifest,
} from "../src/storeListing";

describe("parseStoreManifest", () => {
    test("absent is no listing; a full block round-trips", () => {
        expect(parseStoreManifest(undefined)).toBeNull();
        expect(
            parseStoreManifest({
                about: "./store/about.md",
                screenshots: [{ light: "store/1-light.png", dark: "./store/1-dark.webp", alt: "  Chat  " }],
                requirements: [{ name: "RAM", detail: "16 GB" }],
            }),
        ).toEqual({
            about: "./store/about.md",
            screenshots: [{ light: "store/1-light.png", dark: "./store/1-dark.webp", alt: "Chat" }],
            services: [],
            credits: [],
            requirements: [{ name: "RAM", detail: "16 GB" }],
        });
    });

    const refused: [string, unknown][] = [
        ["path outside store/", { about: "./README.md" }],
        ["traversal", { screenshots: [{ light: "./store/../manifest.png" }] }],
        ["absolute path", { screenshots: [{ light: "/store/1.png" }] }],
        ["non-image screenshot", { screenshots: [{ light: "./store/1.svg" }] }],
        ["about that is not markdown", { about: "./store/about.html" }],
        ["row without detail", { credits: [{ name: "x" }] }],
        ["table that is not an array", { services: { name: "x", detail: "y" } }],
        ["too many rows", { requirements: Array.from({ length: 13 }, () => ({ name: "a", detail: "b" })) }],
        ["too many screenshots", { screenshots: Array.from({ length: 9 }, () => ({ light: "./store/1.png" })) }],
        ["not an object", "store"],
    ];
    for (const [label, raw] of refused) {
        test(`refuses ${label}`, () => {
            expect(() => parseStoreManifest(raw)).toThrow();
        });
    }
});

describe("parseStoreListing", () => {
    test("drops unrenderable entries instead of failing the page", () => {
        expect(
            parseStoreListing({
                about: "Hello",
                screenshots: [
                    { light: "https://r.example/a.png", dark: "data:image/png;base64,AA" },
                    { light: "javascript:alert(1)" },
                    { light: "//evil.example/a.png" },
                    { light: "/panel/x/media/1/0-light.png" },
                ],
                services: [{ name: "Ollama", detail: "Models" }, { name: "" }, "junk"],
            }),
        ).toEqual({
            about: "Hello",
            screenshots: [
                { light: "https://r.example/a.png" },
                { light: "/panel/x/media/1/0-light.png" },
            ],
            services: [{ name: "Ollama", detail: "Models" }],
            credits: [],
            requirements: [],
        });
    });

    test("a record without a listing has none", () => {
        expect(parseStoreListing(undefined)).toBeNull();
        expect(parseStoreListing("about")).toBeNull();
    });
});

describe("loadInstalledPanelMedia", () => {
    const { readFileSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const aiDir = (require("url") as typeof import("url")).fileURLToPath(
        new URL("../../../panels/dev.paperboard.ai", import.meta.url),
    );
    const readFrom = (files: Record<string, Uint8Array>) => async (path: string) => {
        const bytes = files[path.replace(/^\.\//, "")];
        if (!bytes) throw new Error(`ENOENT ${path}`);
        return bytes;
    };

    test("reads a real panel's icon and listing as renderable data images", async () => {
        const read = async (path: string) => new Uint8Array(readFileSync(join(aiDir, path)));
        const media = await loadInstalledPanelMedia(read, true);
        expect(isDataImage(media.icon)).toBe(true);
        expect(media.store!.about).toContain("Ollama");
        expect(media.store!.screenshots.length).toBe(4);
        // what the shell sends survives the library's parser intact
        expect(parseStoreListing(media.store, { allowDataImages: true })).toEqual(media.store!);
        // and without the opt-in, data images never render
        expect(parseStoreListing(media.store)!.screenshots).toEqual([]);
    });

    test("icon-only reads touch no listing files", async () => {
        const manifest = new TextEncoder().encode(
            JSON.stringify({ icon: "./branding/icon.png", store: { about: "./store/about.md" } }),
        );
        const media = await loadInstalledPanelMedia(
            readFrom({ "manifest.json": manifest, "branding/icon.png": new Uint8Array([1, 2]) }),
            false,
        );
        expect(media).toEqual({ icon: "data:image/png;base64,AQI=" });
    });

    test("a listing naming a missing file is a failure, not a partial page", async () => {
        const manifest = new TextEncoder().encode(
            JSON.stringify({ store: { screenshots: [{ light: "./store/1.png" }] } }),
        );
        await expect(
            loadInstalledPanelMedia(readFrom({ "manifest.json": manifest }), true),
        ).rejects.toThrow(/ENOENT/);
    });

    test("svg data and oversized payloads are not data images", () => {
        expect(isDataImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
        expect(isDataImage(`data:image/png;base64,${"A".repeat(3_000_000)}`)).toBe(false);
    });
});
