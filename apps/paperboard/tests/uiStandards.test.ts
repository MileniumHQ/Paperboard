// The shell is built from PaperUI props, with its own look in the stylesheets
// beside each component. The only inline styles are values worked out live:
// where Home's grid, pages and widgets sit and how big they are, where the
// title bar's labels clear the window controls, and data a widget shows (a
// computer's OS tint, a flag's stripes).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src/renderer/src", import.meta.url).pathname;
const LIVE_PROPS = new Set(["left", "right", "top", "width", "height", "transform", "background"]);
// a live value is worked out from state; a fixed one, a design token
// included, belongs in a stylesheet
const LIVE_CODE = /\$\{|props\.|\w\(\)|\w\([a-zA-Z_]\w*\)/;
const isLive = (value: string) =>
    LIVE_CODE.test(value.replace(/\$\{\s*getVarCss\([^)]*\)\s*\}/g, "").replace(/getVarCss\([^)]*\)/g, '""'));
// style objects built elsewhere from live geometry, passed through whole
const PASSED_THROUGH = new Set(["props.style", "g().style", "px(rectOf(placementOf(item())))", "px(rectOf(t().placement))"]);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

/** code with its comments blanked out, so their words don't read as code */
function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** the expression inside `style={...}` starting at `open` (the `{`), and where it ends */
function braced(text: string, open: number): { body: string; end: number } {
    let depth = 0;
    let quote = "";
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = "";
            else if (quote === "`" && c === "$" && text[i + 1] === "{") {
                // a template's ${...} nests like code
                const inner = braced(text, i + 1);
                i = inner.end;
            }
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") {
            depth--;
            if (depth === 0) return { body: text.slice(open + 1, i), end: i };
        }
    }
    throw new Error(`unclosed brace at ${open}`);
}

/** the top-level `key: value` entries of an object literal's body */
function entries(body: string): [string, string][] {
    const parts: string[] = [];
    let depth = 0;
    let quote = "";
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = "";
            else if (quote === "`" && c === "$" && body[i + 1] === "{") i = braced(body, i + 1).end;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if ("{([".includes(c)) depth++;
        else if ("})]".includes(c)) depth--;
        else if (c === "," && depth === 0) {
            parts.push(body.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(body.slice(start));
    return parts
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const match = part.match(/^["']?([\w-]+)["']?\s*:\s*([\s\S]*)$/);
            return match ? [match[1], match[2]] : [part, ""];
        });
}

describe("UI standards", () => {
    test("inline styles only carry values worked out live", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const text = withoutComments(readFileSync(file, "utf8"));
            const where = (index: number) => `${relative(SRC, file)}:${text.slice(0, index).split("\n").length}`;
            for (const tag of text.matchAll(/<style\b/g)) offenders.push(`${where(tag.index)}: a style tag`);
            for (const write of text.matchAll(/\.style\.([a-zA-Z]+)\s*=(?!=)\s*([^\n;]*)/g)) {
                const prop = write[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
                if (!LIVE_PROPS.has(prop) || !isLive(write[2])) offenders.push(`${where(write.index)}: ${write[0]}`);
            }
            for (const write of text.matchAll(/\.style\s*=(?!=)|\.style\.(setProperty|cssText)/g)) {
                offenders.push(`${where(write.index)}: ${write[0]}`);
            }
            for (const attr of text.matchAll(/\bstyle=\{/g)) {
                const { body } = braced(text, attr.index + "style=".length);
                const expression = body.trim();
                if (!expression.startsWith("{")) {
                    if (!PASSED_THROUGH.has(expression)) offenders.push(`${where(attr.index)}: style={${expression}}`);
                    continue;
                }
                for (const [key, value] of entries(braced(expression, 0).body)) {
                    const live = isLive(value);
                    // a custom property hands a live value to the stylesheet
                    if (key.startsWith("--") ? !live : !LIVE_PROPS.has(key) || !live) {
                        offenders.push(`${where(attr.index)}: ${key}: ${value}`);
                    }
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test("every modal stays mounted and opens through its open prop", () => {
        // a modal inside <Show>, <Match> or a render callback mounts and
        // unmounts instead of opening and closing like every other modal
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const lines = readFileSync(file, "utf8").split("\n");
            lines.forEach((line, index) => {
                if (!/<PaperModal\b/.test(line)) return;
                const before = lines.slice(0, index).reverse().find((l) => l.trim() !== "") ?? "";
                if (/<Show\b|<Match\b|=>\s*\(?\s*$/.test(before)) {
                    offenders.push(`${relative(SRC, file)}:${index + 1}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });

    test("a modal's footer is its buttons, laid out by the modal", () => {
        // PaperModal lays out and wraps its footer; a row around the buttons
        // fights that layout
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const text = readFileSync(file, "utf8");
            for (const footer of text.matchAll(/footer=\{\s*<(?!>)/g)) {
                offenders.push(`${relative(SRC, file)}:${text.slice(0, footer.index).split("\n").length}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
