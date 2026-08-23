import type { PaperSpacing, PaperColor, PaperBackgroundSurface } from "../types";

export const SPACING_MAP: Record<string, string> = {
    none: "0",
    onefourth: "var(--paper-uigap-onefourth)",
    half: "var(--paper-uigap-half)",
    threefourths: "var(--paper-uigap-threefourths)",
    full: "var(--paper-uigap)",
    sixfourths: "var(--paper-uigap-sixfourths)",
    double: "var(--paper-uigap-double)",
    triple: "var(--paper-uigap-triple)",
    quadruple: "var(--paper-uigap-quadruple)",
};

/**
 * Resolves a spacing token name, pixel number, or raw CSS string to a valid CSS value.
 * Allows writing "half", "full", "onefourth", etc., directly without getVar or var().
 */
export function resolveSpacing(val?: PaperSpacing): string | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === "number") return `${val}px`;
    return SPACING_MAP[val] || (val.startsWith("var(") || val.startsWith("calc(") || val.endsWith("px") || val.endsWith("rem") || val.endsWith("%") ? val : `var(--paper-${val})`);
}

/**
 * Resolves a background surface token name, custom property, or CSS color string to a valid CSS value.
 * Allows writing "front", "backest", "definition", etc., without getVar or var().
 */
export function resolveBackground(val?: PaperBackgroundSurface | string): string | undefined {
    if (!val) return undefined;
    if (val.startsWith("var(") || val.startsWith("#") || val.startsWith("rgb") || val.startsWith("hsl") || val === "transparent") {
        return val;
    }
    if (val.startsWith("--paper-")) {
        return `var(${val})`;
    }
    if (val.startsWith("paper-")) {
        return `var(--${val})`;
    }
    return `var(--paper-background-${val}, var(--paper-${val}))`;
}

/**
 * Resolves a color token name (e.g. "front-blue", "light-text", "blue", "main-text")
 * or CSS color string to a valid CSS value without getVar or var().
 */
export function resolveColor(val?: PaperColor | string): string | undefined {
    if (!val) return undefined;
    if (val.startsWith("var(") || val.startsWith("#") || val.startsWith("rgb") || val.startsWith("hsl") || val === "currentColor" || val === "transparent") {
        return val;
    }
    if (val.startsWith("--paper-")) {
        return `var(${val})`;
    }
    if (val.startsWith("paper-")) {
        return `var(--${val})`;
    }
    if (val === "blue" || val === "green" || val === "red" || val === "yellow") {
        return `var(--paper-front-${val})`;
    }
    return `var(--paper-${val})`;
}

/**
 * Retrieves the computed string value of a PaperUI CSS variable from document root or body.
 * Supports passing full variable names (e.g. "--paper-front-blue"), prefixed names ("paper-front-blue"),
 * or shorthand token names ("front-blue", "light-text").
 *
 * @param name The CSS custom property name or shorthand token name.
 * @param fallback Optional fallback value if the property is undefined.
 * @returns The resolved CSS property string value.
 */
export function getVar(name: string, fallback: string = ""): string {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return fallback;
    }
    const varName = name.startsWith("--")
        ? name
        : name.startsWith("paper-")
          ? `--${name}`
          : `--paper-${name}`;

    const val =
        getComputedStyle(document.documentElement)
            .getPropertyValue(varName)
            .trim() ||
        getComputedStyle(document.body).getPropertyValue(varName).trim();
    return val || fallback;
}

/**
 * Formats a CSS variable expression string suitable for inline styles.
 * E.g. getVarCss("light-text") => "var(--paper-light-text)"
 */
export function getVarCss(name: string, fallback?: string): string {
    const varName = name.startsWith("--")
        ? name
        : name.startsWith("paper-")
          ? `--${name}`
          : `--paper-${name}`;
    return fallback ? `var(${varName}, ${fallback})` : `var(${varName})`;
}
