// The panel is built from PaperUI props, with its canvas's own look in the
// stylesheets beside each component. The only inline styles are geometry
// that follows the person live: where a block, note, menu or dragged ghost
// sits, how far the canvas scrolled and how big it is, and the width an
// edited field holds while it's typed into.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;
const GEOMETRY = new Set(["left", "top", "width", "height", "transform", "z-index", "background-position"]);
// a live value is worked out from state; a fixed one belongs in a stylesheet
const LIVE_VALUE = /\$\{|props\.|\w\(\)/;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

describe("UI standards", () => {
    test("inline styles only place things where the person moved them", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const lines = readFileSync(file, "utf8").split("\n");
            const where = (index: number) => `${relative(SRC, file)}:${index + 1}`;
            lines.forEach((line, index) => {
                if (/<style\b/.test(line)) offenders.push(`${where(index)}: a style tag`);

                const write = line.match(/\.style\.([a-zA-Z]+)\s*=(?!=)\s*(.*)$/);
                if (write) {
                    const prop = write[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
                    const cleared = /^["'`]{2};?$/.test(write[2].trim());
                    if (!GEOMETRY.has(prop) || (!cleared && !LIVE_VALUE.test(write[2]))) {
                        offenders.push(`${where(index)}: ${line.trim()}`);
                    }
                }
                if (/\.style\s*=(?!=)|\.style\.(setProperty|cssText)/.test(line)) {
                    offenders.push(`${where(index)}: ${line.trim()}`);
                }

                if (!/\bstyle=/.test(line)) return;
                if (!/\bstyle=\{\{\s*$/.test(line)) {
                    offenders.push(`${where(index)}: style must be an object of live geometry`);
                    return;
                }
                for (let i = index + 1; i < lines.length && !/^\s*\}\}/.test(lines[i]); i++) {
                    const entry = lines[i].match(/^\s*"?([a-z-]+)"?\s*:\s*(.*)$/);
                    if (!entry) continue;
                    if (!GEOMETRY.has(entry[1]) || !LIVE_VALUE.test(entry[2])) {
                        offenders.push(`${where(i)}: ${lines[i].trim()}`);
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
});
