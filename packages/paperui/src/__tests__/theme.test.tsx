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
        expect(resolveBackground("front")).toBe("var(--paper-background-front, var(--paper-front))");
        expect(resolveBackground("backest")).toBe("var(--paper-background-backest, var(--paper-backest))");
        expect(resolveBackground("#ff0000")).toBe("#ff0000");
        expect(resolveBackground("var(--custom-bg)")).toBe("var(--custom-bg)");
        expect(resolveBackground(undefined)).toBeUndefined();
    });

    test("resolves color tokens to CSS variables without var()", () => {
        expect(resolveColor("front-blue")).toBe("var(--paper-front-blue)");
        expect(resolveColor("light-text")).toBe("var(--paper-light-text)");
        expect(resolveColor("blue")).toBe("var(--paper-front-blue)");
        expect(resolveColor("green")).toBe("var(--paper-front-green)");
        expect(resolveColor("#ffffff")).toBe("#ffffff");
        expect(resolveColor("currentColor")).toBe("currentColor");
        expect(resolveColor(undefined)).toBeUndefined();
    });

    test("formats getVarCss accurately", () => {
        expect(getVarCss("light-text")).toBe("var(--paper-light-text)");
        expect(getVarCss("--paper-front-blue")).toBe("var(--paper-front-blue)");
        expect(getVarCss("paper-front-blue")).toBe("var(--paper-front-blue)");
        expect(getVarCss("light-text", "#000")).toBe("var(--paper-light-text, #000)");
    });
});
