// PaperUI's tokens as values: Blockly draws in numbers and colours, not CSS
// variables, so the blocks read each token from the page once it's styled.
//
// Reading one asks the page for its computed style, which makes the browser
// restyle everything changed since; asked for every block while hundreds are
// drawn, that's most of the time a slow computer takes to draw them. So each
// token is read once per theme: the cache is kept with what picks the theme
// (the root's theme attributes and the system's light or dark), and a read
// under another theme starts it over.
const cache = new Map<string, string>();
let cachedTheme = "";

function theme(): string {
    const root = document.documentElement;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return [root.getAttribute("data-theme"), root.getAttribute("data-paperui-theme"), root.className, root.getAttribute("style"), dark].join("|");
}

export function token(name: string): string {
    const now = theme();
    if (now !== cachedTheme) {
        cache.clear();
        cachedTheme = now;
    }
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) throw new Error(`${name} isn't set, so blocks can't be drawn`);
    cache.set(name, value);
    return value;
}

/** A token that's a length in pixels. One written as calc() isn't read: name the pixels it's made of. */
export function tokenPixels(name: string): number {
    const value = parseFloat(token(name));
    if (!Number.isFinite(value)) throw new Error(`${name} isn't a length, so blocks can't be drawn`);
    return value;
}
