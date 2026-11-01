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

    test("Cancel beside a confirm that is not danger is a text button", () => {
        // a danger confirm keeps a bordered Cancel; any other confirm is the
        // blue one, and Cancel steps back from it
        const offenders: string[] = [];
        for (const file of tsxFiles(SRC)) {
            const lines = readFileSync(file, "utf8").split("\n");
            lines.forEach((line, index) => {
                const cancel = lines.slice(Math.max(0, index - 3), index + 1).join(" ");
                if (!/>\s*Cancel\s*(<\/PaperButton>)?\s*$/.test(line)) return;
                const opening = cancel.slice(cancel.lastIndexOf("<PaperButton"));
                if (!/>\s*Cancel\s*(<\/PaperButton>)?\s*$/.test(opening)) return;
                const after = lines.slice(index + 1, index + 12).join(" ");
                const confirm = after.slice(after.indexOf("<PaperButton"), after.indexOf(">", after.indexOf("<PaperButton")));
                if (!confirm || /variant="danger"/.test(confirm)) return;
                if (!/variant=("text"|\{[^}]*"text")/.test(opening)) offenders.push(`${relative(SRC, file)}:${index + 1}`);
            });
        }
        expect(offenders).toEqual([]);
    });

    test("a game builds its screens from the shared pieces", () => {
        // adding a game means filling in GameRoster and the install pieces,
        // not copying the roster list, the install modal or the loader rows
        const own: Record<string, RegExp> = {
            "PlayerRoster": /from "[^"]*components\/PlayerRoster"/,
            "InstallLoaders": /from "[^"]*components\/InstallLoaders"/,
            "PaperAvatar": /\bPaperAvatar\b[^\n]*fallbackIcon="person"/,
        };
        const offenders: string[] = [];
        for (const file of tsxFiles(join(SRC, "games"))) {
            const text = readFileSync(file, "utf8");
            for (const [name, pattern] of Object.entries(own)) {
                if (pattern.test(text)) offenders.push(`${relative(SRC, file)} builds its own ${name}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
