// The panel is built from PaperUI props: no style tags, no style writes.
// Custom UI (the Home widgets) keeps its look in its own stylesheet.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;

function tsxFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return tsxFiles(path);
        return entry.name.endsWith(".tsx") ? [path] : [];
    });
}

describe("UI standards", () => {
    test("no component sets an inline style", () => {
        const offenders: string[] = [];
        for (const file of tsxFiles(SRC)) {
            readFileSync(file, "utf8")
                .split("\n")
                .forEach((line, index) => {
                    if (/\bstyle=\{|\.style\.|\.style\s*=/.test(line)) {
                        offenders.push(`${relative(SRC, file)}:${index + 1}: ${line.trim()}`);
                    }
                });
        }
        expect(offenders).toEqual([]);
    });

    test("every modal stays mounted and opens through its open prop", () => {
        // a modal inside <Show>, <Match> or a render callback mounts and
        // unmounts instead of opening and closing like every other modal
        const offenders: string[] = [];
        for (const file of tsxFiles(SRC)) {
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
