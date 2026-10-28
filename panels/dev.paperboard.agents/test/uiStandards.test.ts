// The panel is built from PaperUI: its pages are PaperUI components laid
// out with PaperUI props, and its own look (the face, the chat's bubbles and
// composer, the computer's windows) sits in the stylesheets beside them, in
// PaperUI's tokens. A footprint PaperUI has no token for is named once in
// tokens.css. The only inline styles are values that follow the person
// live: a swiped bubble, the composer's height, a skin's colour.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { paperColors } from "../../../packages/paperui/src/types";

const SRC = new URL("../src", import.meta.url).pathname;
const PAPERUI = new URL("../../../packages/paperui/src", import.meta.url).pathname;
const TOKENS = join(SRC, "tokens.css");

// the service runs in Node and draws nothing
const isUi = (path: string) => !relative(SRC, path).startsWith("service");
// what can follow a person live: a bubble's swipe, the composer's height, a value fed from data
const LIVE_KEYS = new Set(["transform", "opacity", "height"]);
const LIVE_VALUE = /\$\{|props\.|\w\(\)/;
// the pages a person reads and fills in are plain PaperUI; the face, the chat's bubbles and
// composer, the computer's windows and the face playground draw their own
const PLAIN = ["Main.tsx", "Workspace.tsx", "settings", "tools", "memories", "routines", "onboarding", "lib", "chat/History.tsx", "chat/SignIn.tsx", "apps/Apps.tsx"];
// a button that backs out of a question sits quietly next to the coloured one that answers it
const BACK_OUT = new Set(["Cancel", "Keep it", "Keep talking", "Not now", "Stay"]);

function files(dir: string, ext: RegExp): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return files(path, ext);
        return ext.test(entry.name) ? [path] : [];
    });
}
const sources = () => files(SRC, /\.tsx?$/).filter(isUi);
const sheets = () => files(SRC, /\.css$/).filter(isUi);
const where = (file: string, index: number) => `${relative(SRC, file)}:${index + 1}`;
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/** Each `<Tag …>children</Tag>`, with its attributes read past the arrows and braces inside them. */
function elements(text: string, tag: string): { attrs: string; children: string; line: number }[] {
    const found: { attrs: string; children: string; line: number }[] = [];
    const open = new RegExp(`<${tag}\\b`, "g");
    for (let m = open.exec(text); m; m = open.exec(text)) {
        let depth = 0;
        let i = m.index + m[0].length;
        for (; i < text.length; i++) {
            const c = text[i];
            if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === ">" && depth === 0) break;
        }
        const attrs = text.slice(m.index + m[0].length, i);
        const close = text.indexOf(`</${tag}>`, i);
        const children = attrs.endsWith("/") || close < 0 ? "" : text.slice(i + 1, close);
        found.push({ attrs, children, line: text.slice(0, m.index).split("\n").length - 1 });
    }
    return found;
}

describe("UI standards", () => {
    test("inline styles only carry values that follow the person live", () => {
        const offenders: string[] = [];
        for (const file of sources()) {
            const lines = readFileSync(file, "utf8").split("\n");
            lines.forEach((line, index) => {
                if (/<style\b/.test(line)) offenders.push(`${where(file, index)}: a style tag`);

                const write = line.match(/\.style\.([a-zA-Z]+)\s*=(?!=)\s*(.*)$/);
                if (write) {
                    const prop = write[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
                    const cleared = /^["'`]{2};?/.test(write[2].trim());
                    if (!LIVE_KEYS.has(prop) || (!cleared && !LIVE_VALUE.test(write[2]))) offenders.push(`${where(file, index)}: ${line.trim()}`);
                }
                if (/\.style\s*=(?!=)|\.style\.(setProperty|cssText)/.test(line)) offenders.push(`${where(file, index)}: ${line.trim()}`);

                const inline = line.match(/\bstyle=\{(.*)$/);
                if (!inline) return;
                // the object may run on to the lines after
                let body = inline[1];
                for (let i = index + 1; !/\}\}/.test(body) && i < lines.length; i++) body += lines[i];
                const entries = [...body.matchAll(/"?(--[a-z-]+|[a-z-]+)"?\s*:\s*([^,}]+)/g)];
                if (entries.length === 0) offenders.push(`${where(file, index)}: style must be an object of live values`);
                for (const [, key, value] of entries) {
                    if ((!key.startsWith("--") && !LIVE_KEYS.has(key)) || !LIVE_VALUE.test(value)) {
                        offenders.push(`${where(file, index)}: ${key}: ${value.trim()}`);
                    }
                }
            });
        }
        expect(offenders).toEqual([]);
    });

    test("every modal stays mounted and opens through its open prop", () => {
        // a modal inside <Show>, <Match> or a render callback mounts and
        // unmounts instead of opening and closing like every other modal
        const offenders: string[] = [];
        for (const file of sources()) {
            const lines = readFileSync(file, "utf8").split("\n");
            lines.forEach((line, index) => {
                if (!/<PaperModal\b/.test(line)) return;
                const before = lines.slice(0, index).reverse().find((l) => l.trim() !== "") ?? "";
                if (/<Show\b|<Match\b|=>\s*\(?\s*$/.test(before)) offenders.push(where(file, index));
            });
        }
        expect(offenders).toEqual([]);
    });

    test("a button that backs out of a question is a text button", () => {
        const offenders: string[] = [];
        for (const file of sources()) {
            for (const b of elements(readFileSync(file, "utf8"), "PaperButton")) {
                const label = b.children.replace(/\{[^}]*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*\}/g, "$1|$2").trim();
                const backsOut = label.split("|").some((l) => BACK_OUT.has(l.trim()));
                if (backsOut && !/variant="text"/.test(b.attrs)) offenders.push(`${where(file, b.line)}: ${label}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test("a failure is a danger quote that names what didn't happen", () => {
        // a red line of text is easy to miss and says nothing of which button failed
        const offenders: string[] = [];
        for (const file of sources()) {
            const text = readFileSync(file, "utf8");
            for (const t of elements(text, "PaperText")) {
                if (/color="danger"/.test(t.attrs)) offenders.push(`${where(file, t.line)}: danger text, not a quote`);
            }
            for (const q of elements(text, "PaperQuote")) {
                if (/variant="danger"/.test(q.attrs) && (!/\btitle=/.test(q.attrs) || !/\bicon=/.test(q.attrs))) {
                    offenders.push(`${where(file, q.line)}: a danger quote without its title and icon`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test("the pages a person reads are PaperUI, not raw text and buttons", () => {
        const offenders: string[] = [];
        for (const file of sources()) {
            const path = relative(SRC, file);
            if (!PLAIN.some((p) => path === p || path.startsWith(`${p}/`))) continue;
            readFileSync(file, "utf8")
                .split("\n")
                .forEach((line, index) => {
                    const raw = line.match(/<(p|h[1-6]|button|label|ul|ol|li)\b/);
                    if (raw) offenders.push(`${where(file, index)}: <${raw[1]}>`);
                });
        }
        expect(offenders).toEqual([]);
    });

    test("every colour named is one of PaperUI's", () => {
        const known = new Set<string>(paperColors);
        const offenders: string[] = [];
        for (const file of sources()) {
            readFileSync(file, "utf8")
                .split("\n")
                .forEach((line, index) => {
                    for (const [, color] of line.matchAll(/\bcolor="([^"]+)"/g)) {
                        if (!known.has(color)) offenders.push(`${where(file, index)}: ${color}`);
                    }
                });
        }
        expect(offenders).toEqual([]);
    });

    test("every PaperUI token used is one PaperUI defines", () => {
        const defined = new Set<string>();
        for (const file of files(PAPERUI, /\.(css|tsx?)$/)) {
            for (const [, name] of readFileSync(file, "utf8").matchAll(/["']?(--paper-[a-z0-9-]+)["']?\s*:/g)) defined.add(name);
        }
        const offenders: string[] = [];
        for (const file of [...sheets(), ...sources()]) {
            readFileSync(file, "utf8")
                .split("\n")
                .forEach((line, index) => {
                    for (const [, name] of line.matchAll(/var\((--paper-[a-z0-9-]+)/g)) {
                        if (!defined.has(name)) offenders.push(`${where(file, index)}: ${name}`);
                    }
                });
        }
        expect(offenders).toEqual([]);
    });

    test("the panel's own footprints are named once, in tokens.css, and all used", () => {
        const css = withoutComments(readFileSync(TOKENS, "utf8"));
        const defined = new Set([...css.matchAll(/(--agents-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
        const used = new Set<string>();
        const offenders: string[] = [];
        for (const file of [...sheets(), ...sources()]) {
            const text = withoutComments(readFileSync(file, "utf8"));
            for (const [, name] of text.matchAll(/var\((--agents-[a-z0-9-]+)/g)) {
                used.add(name);
                if (!defined.has(name)) offenders.push(`${relative(SRC, file)}: ${name} isn't in tokens.css`);
            }
            if (file !== TOKENS && /--agents-[a-z0-9-]+\s*:/.test(text)) offenders.push(`${relative(SRC, file)}: defines a panel token outside tokens.css`);
        }
        for (const name of defined) if (!used.has(name)) offenders.push(`tokens.css: ${name} is never used`);
        expect(offenders).toEqual([]);
    });

    test("stylesheets size and time things in tokens, not raw units", () => {
        // a media query can't read a variable, so its width is the one literal allowed
        const offenders: string[] = [];
        for (const file of sheets()) {
            if (file === TOKENS) continue;
            withoutComments(readFileSync(file, "utf8"))
                .split("\n")
                .forEach((line, index) => {
                    if (/^\s*@media\b/.test(line)) return;
                    const raw = line.match(/(?<![\w-])\d*\.?\d+(px|rem|em|vh|vw|ms|s)\b/);
                    if (raw) offenders.push(`${where(file, index)}: ${line.trim()}`);
                    const unitless = line.match(/\b(line-height|letter-spacing)\s*:\s*\d/) ?? line.match(/\bscale\(\s*\d/);
                    if (unitless) offenders.push(`${where(file, index)}: ${line.trim()}`);
                });
        }
        expect(offenders).toEqual([]);
    });

    test("the panel's own tokens size nothing PaperUI's size tokens should", () => {
        // a window share, a time or a scale is the panel's own; a length is
        // one of PaperUI's sizes
        const offenders = withoutComments(readFileSync(TOKENS, "utf8"))
            .split("\n")
            .filter((line) => /(?<![\w-])\d*\.?\d+(px|rem|em)\b/.test(line))
            .map((line) => `tokens.css: ${line.trim()}`);
        expect(offenders).toEqual([]);
    });
});
