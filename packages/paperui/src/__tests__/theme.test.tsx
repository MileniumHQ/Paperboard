/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { getVarCss, paperSizes, resolveBackground, resolveColor, resolveSpacing } from "../index";

const STYLES = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");

// styles.css and every stylesheet it imports, as one text
function tokenSheets(): string {
    const entry = readFileSync(join(STYLES, "styles.css"), "utf8");
    const imports = [...entry.matchAll(/@import\s+"\.\/([^"]+)"/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    return [entry, ...imports.map((file) => readFileSync(join(STYLES, file), "utf8"))].join("\n");
}

// Inventory: Layout and navigation — Theme and token helpers (resolvers and size tokens;
// PaperProvider's theme choice is proven in Chrome, test/browser/theme.test.ts).
describe("theme and token helpers", () => {
    test("resolveColor passes CSS colours through and resolves token names to --paper variables", () => {
        for (const css of [
            "#ff8800",
            "#fff",
            "rgb(1, 2, 3)",
            "rgba(1, 2, 3, 0.5)",
            "hsl(10 20% 30%)",
            "oklch(0.7 0.1 200)",
            "color-mix(in srgb, red 50%, blue)",
            "light-dark(white, black)",
            "var(--brand)",
            "currentColor",
            "transparent",
        ]) {
            expect(resolveColor(css)).toBe(css);
        }
        expect(resolveColor("primary")).toBe("var(--paper-primary)");
        expect(resolveColor("text-subtle")).toBe("var(--paper-text-subtle)");
        expect(resolveColor(undefined)).toBeUndefined();
    });

    test("getVarCss maps a token name, a paper- name or a raw custom property to var()", () => {
        expect(getVarCss("surface")).toBe("var(--paper-surface)");
        expect(getVarCss("paper-surface")).toBe("var(--paper-surface)");
        expect(getVarCss("--panel-accent")).toBe("var(--panel-accent)");
        expect(getVarCss("uigap", "8px")).toBe("var(--paper-uigap, 8px)");
    });

    test("resolveSpacing maps spacing tokens and passes lengths through", () => {
        expect(resolveSpacing("none")).toBe("0");
        expect(resolveSpacing("half")).toBe("var(--paper-uigap-half)");
        expect(resolveSpacing("full")).toBe("var(--paper-uigap)");
        expect(resolveSpacing("double")).toBe("var(--paper-uigap-double)");
        expect(resolveSpacing(12)).toBe("12px");
        for (const css of ["4px", "1.5rem", "50%", "calc(1px + 2px)", "var(--x)"]) expect(resolveSpacing(css)).toBe(css);
        expect(resolveSpacing("inset")).toBe("var(--paper-inset)");
        expect(resolveSpacing(undefined)).toBeUndefined();
    });

    test("resolveBackground maps surfaces to tokens and passes colours through", () => {
        expect(resolveBackground("surface-raised")).toBe("var(--paper-surface-raised)");
        expect(resolveBackground("paper-surface")).toBe("var(--paper-surface)");
        expect(resolveBackground("--paper-surface")).toBe("var(--paper-surface)");
        for (const css of ["#102030", "rgb(0 0 0)", "hsl(0 0% 0%)", "var(--x)", "transparent"]) {
            expect(resolveBackground(css)).toBe(css);
        }
    });

    test("every paperSizes name is defined as --paper-size-<name>", () => {
        const sheets = tokenSheets();
        const missing = paperSizes.filter((name) => !new RegExp(`--paper-size-${name}\\s*:`).test(sheets));
        expect(missing).toEqual([]);
    });
});
