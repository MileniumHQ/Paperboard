// The panel is built from PaperUI props: no style tags, no style writes.
// Custom UI (the map, the MOTD) keeps its look in its own CSS module.
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
});
