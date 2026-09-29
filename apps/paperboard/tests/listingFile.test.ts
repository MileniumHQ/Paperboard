// The panel-listing-file shell channel reads through the panel:// resolver,
// which injects credentials into HTML. Only the manifest and listing media
// may cross it.
import { describe, expect, it } from "bun:test";
import { isListingFilePath } from "../src/main/communication/shellHandlers";

describe("panel-listing-file allowlist", () => {
    it("allows the manifest and listing media", () => {
        for (const ok of ["manifest.json", "store/about.md", "store/1-dark.png", "branding/icon.webp", "store/a.JPG"]) {
            expect(isListingFilePath(ok)).toBe(true);
        }
    });

    it("refuses documents, scripts, other json and traversal", () => {
        for (const bad of ["index.html", "dist/index.html", "dist/service.js", "config.json", "store/../../secret.png", "store/x.svg"]) {
            expect(isListingFilePath(bad)).toBe(false);
        }
    });
});
