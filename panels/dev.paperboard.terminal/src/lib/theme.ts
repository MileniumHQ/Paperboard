import { getVar } from "@mileniumhq/paperui";

// xterm paints a canvas, so it needs the theme's resolved values; a token
// that isn't defined is a broken stylesheet, not a reason to guess a color
export function token(name: string): string {
    const value = getVar(name);
    if (!value) throw new Error(`PaperUI token --paper-${name} is not defined`);
    return value;
}

/** the colors a screen is painted with, read from the theme as it is now */
export function screenColors() {
    const fg = token("text");
    const blue = token("primary");
    const red = token("danger");
    const green = token("success");
    const yellow = token("warning");
    const lightText = token("text-subtle");
    const selection = token("selection");
    return {
        theme: {
            // the screen is the paper its active tab sits on
            background: token("surface-raised"),
            foreground: fg,
            cursor: blue,
            selectionBackground: selection,
            black: token("surface-sunken"),
            red,
            green,
            yellow,
            blue,
            white: fg,
            brightBlack: lightText,
            brightRed: red,
            brightGreen: green,
            brightYellow: yellow,
            brightBlue: blue,
            brightWhite: fg,
        },
        search: {
            matchBackground: selection,
            matchOverviewRuler: blue,
            activeMatchBackground: yellow,
            activeMatchColorOverviewRuler: yellow,
        },
    };
}

/**
 * Calls `changed` when the app's theme switches. PaperProvider sets the
 * resolved theme as data-paperui-theme (on its root, and on the body), so the
 * attribute is what to watch. Returns the way to stop.
 */
export function onThemeChange(changed: () => void): () => void {
    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-paperui-theme"], subtree: true });
    return () => observer.disconnect();
}
