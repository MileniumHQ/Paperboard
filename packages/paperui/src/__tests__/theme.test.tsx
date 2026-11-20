import { describe, expect, test } from "vitest";
import { getVarCss, resolveColor } from "../index";

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

});
