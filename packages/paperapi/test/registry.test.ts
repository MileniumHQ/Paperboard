import { describe, expect, test } from "bun:test";
import { parseStoreListing, parseStoreManifest } from "../src/storeListing";

// Untrusted registry and listing input is bounded.
describe("untrusted registry and listing input is bounded", () => {
    test("parseStoreManifest refuses paths outside store/, traversal, absolute paths and svg screenshots", () => {
        const bad = [
            { about: "./README.md" },
            { about: "./store/../secret.md" },
            { about: "/etc/passwd.md" },
            { about: "store/about.txt" },
            { screenshots: [{ light: "./store/shot.svg" }] },
            { screenshots: [{ light: "../store/shot.png" }] },
            { screenshots: [{ light: "./store/a.png", dark: "C:/shot.png" }] },
            { screenshots: [{ light: "./store/sub/../../x.png" }] },
        ];
        for (const store of bad) expect(() => parseStoreManifest(store)).toThrow(/store\./);
        expect(parseStoreManifest({ about: "./store/about.md", screenshots: [{ light: "./store/1-light.png", dark: "store/1-dark.webp", alt: "Chat" }] })).toEqual({
            about: "./store/about.md",
            screenshots: [{ light: "./store/1-light.png", dark: "store/1-dark.webp", alt: "Chat" }],
            services: [],
            credits: [],
            requirements: [],
        });
    });

    test("parseStoreListing drops javascript: and protocol-relative URLs", () => {
        const listing = parseStoreListing({
            screenshots: [
                { light: "javascript:alert(1)" },
                { light: "//evil.example/x.png" },
                { light: "https://i.example/a.png", dark: "javascript:alert(2)" },
                { light: "/media/b.png", dark: "//evil.example/d.png" },
                { light: "data:image/svg+xml;base64,PHN2Zz4=" },
            ],
        });
        expect(listing?.screenshots).toEqual([{ light: "https://i.example/a.png" }, { light: "/media/b.png" }]);
    });
});
