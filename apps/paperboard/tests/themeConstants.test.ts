import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
    TITLEBAR_OVERLAY_COLORS,
    TITLEBAR_SYMBOL_COLORS,
    WINDOW_BACKGROUND_COLORS,
} from "../papercrane/themeConstants";

// The native window chrome cannot read PaperUI CSS variables, so the hex
// values are mirrored in themeConstants.ts. This test reads the token source
// and fails the moment the mirror drifts (the dark overlay was previously
// stuck on the pre-3ec6fc9 palette).
const colorsCss = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "paperui",
    "src",
    "styles",
    "colors.css",
);

function tokenValue(css: string, token: string): string {
    const match = css.match(
        new RegExp(`--paper-${token}:\\s*(#[0-9a-fA-F]{3,8})`),
    );
    if (!match) throw new Error(`token --paper-${token} not found in colors.css`);
    return match[1].toLowerCase();
}

describe("native theme constants mirror PaperUI tokens", () => {
    const css = fs.readFileSync(colorsCss, "utf8");
    const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(darkStart).toBeGreaterThan(-1);
    const lightRegion = css.slice(0, darkStart);
    const darkRegion = css.slice(darkStart);

    it("titlebar overlay matches --paper-background-back", () => {
        expect(TITLEBAR_OVERLAY_COLORS.light.toLowerCase()).toBe(
            tokenValue(lightRegion, "background-back"),
        );
        expect(TITLEBAR_OVERLAY_COLORS.dark.toLowerCase()).toBe(
            tokenValue(darkRegion, "background-back"),
        );
    });

    it("window background matches the renderer base surface", () => {
        expect(WINDOW_BACKGROUND_COLORS.light.toLowerCase()).toBe(
            tokenValue(lightRegion, "background-frontest"),
        );
        expect(WINDOW_BACKGROUND_COLORS.dark.toLowerCase()).toBe(
            tokenValue(darkRegion, "background-backest"),
        );
    });

    it("titlebar symbols match --paper-main-text", () => {
        expect(TITLEBAR_SYMBOL_COLORS.light.toLowerCase()).toBe(
            tokenValue(lightRegion, "main-text"),
        );
        expect(TITLEBAR_SYMBOL_COLORS.dark.toLowerCase()).toBe(
            tokenValue(darkRegion, "main-text"),
        );
    });
});
