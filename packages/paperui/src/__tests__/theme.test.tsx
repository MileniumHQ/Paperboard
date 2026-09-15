import { describe, test, expect } from "vitest";
import {
    resolveSpacing,
    resolveColor,
    resolveBackground,
    getVarCss,
} from "../utils/theme";

describe("Theme & Token Resolution Tests", () => {
    test("resolves spacing tokens to CSS variables without var()", () => {
        expect(resolveSpacing("half")).toBe("var(--paper-uigap-half)");
        expect(resolveSpacing("full")).toBe("var(--paper-uigap)");
        expect(resolveSpacing("onefourth")).toBe("var(--paper-uigap-onefourth)");
        expect(resolveSpacing("none")).toBe("0");
        expect(resolveSpacing(16)).toBe("16px");
        expect(resolveSpacing("20px")).toBe("20px");
        expect(resolveSpacing(undefined)).toBeUndefined();
    });

    test("resolves background surface tokens to CSS variables without var()", () => {
        expect(resolveBackground("surface")).toBe("var(--paper-surface)");
        expect(resolveBackground("surface-app")).toBe("var(--paper-surface-app)");
        expect(resolveBackground("#ff0000")).toBe("#ff0000");
        expect(resolveBackground("var(--custom-bg)")).toBe("var(--custom-bg)");
        expect(resolveBackground(undefined)).toBeUndefined();
    });

    test("resolves roles and token names to CSS variables without var()", () => {
        expect(resolveColor("primary")).toBe("var(--paper-primary)");
        expect(resolveColor("brand")).toBe("var(--paper-brand)");
        expect(resolveColor("danger")).toBe("var(--paper-danger)");
        expect(resolveColor("text-subtle")).toBe("var(--paper-text-subtle)");
        expect(resolveColor("#ffffff")).toBe("#ffffff");
        expect(resolveColor("currentColor")).toBe("currentColor");
        expect(resolveColor(undefined)).toBeUndefined();
    });

    test("formats getVarCss accurately", () => {
        expect(getVarCss("text-subtle")).toBe("var(--paper-text-subtle)");
        expect(getVarCss("--paper-primary")).toBe("var(--paper-primary)");
        expect(getVarCss("paper-primary")).toBe("var(--paper-primary)");
        expect(getVarCss("text-subtle", "#000")).toBe("var(--paper-text-subtle, #000)");
    });
});
