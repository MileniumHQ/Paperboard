import { createSignal } from "solid-js";

// One theme implementation for the docs SPA and the prerendered root pages.
// Both read the theme the inline bootstrap script already resolved on <html>,
// so a page painted from storage and a hydrated app agree on the first frame.
export const THEME_KEY = "paper-docs-theme";

export type PaperTheme = "dark" | "light";

export function readTheme(): PaperTheme {
    if (typeof document !== "undefined") {
        const attribute = document.documentElement.getAttribute(
            "data-paperui-theme",
        );
        if (attribute === "light" || attribute === "dark") return attribute;
    }
    if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === "light" || stored === "dark") return stored;
    }
    return "dark";
}

export function applyTheme(theme: PaperTheme): void {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-paperui-theme", theme);
    document.documentElement.style.colorScheme = theme;
    // The prerendered pages keep the provider root from the server render;
    // its attribute scopes the tokens, so it has to follow the choice.
    for (const root of document.querySelectorAll<HTMLElement>(
        ".paperui-root",
    )) {
        root.setAttribute("data-paperui-theme", theme);
    }
}

export function storeTheme(theme: PaperTheme): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(THEME_KEY, theme);
}

export function createPaperTheme() {
    const [theme, setTheme] = createSignal<PaperTheme>(readTheme());
    applyTheme(theme());

    const toggleTheme = () => {
        const next: PaperTheme = theme() === "dark" ? "light" : "dark";
        setTheme(next);
        storeTheme(next);
        applyTheme(next);
    };

    return { theme, toggleTheme };
}
