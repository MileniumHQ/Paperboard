import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "check-app-styling.py");

// Runs the scanner the way check-app-styling.sh does: file paths on stdin.
function scan(files: Record<string, string>): string[] {
    const dir = mkdtempSync(join(tmpdir(), "app-styling-"));
    try {
        const paths = Object.entries(files).map(([name, body]) => {
            const path = join(dir, name);
            writeFileSync(path, body);
            return path;
        });
        const run = Bun.spawnSync(["python3", "-I", SCRIPT], {
            stdin: new TextEncoder().encode(paths.join("\n")),
        });
        expect(run.exitCode).toBe(0);
        return run.stdout
            .toString()
            .split("\n")
            .filter(Boolean)
            .map((line) => line.replace(dir, ""));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe("check-app-styling scanner", () => {
    it("flags literal sizes, colors, motion, weights, opacity, z-index, scale", () => {
        const found = scan({
            "a.css": [
                "padding: 12px;",
                "color: #fff;",
                "transition: opacity var(--paper-short-transition) ease;",
                "font-weight: 700;",
                "line-height: 1.45;",
                "opacity: 0.5;",
                "z-index: 100;",
                "transform: scale(1.03);",
            ].join("\n"),
        });
        const kinds = found.map((l) => l.split(": ")[1]);
        for (const kind of ["size", "color", "easing", "font-weight", "line-height", "opacity", "z-index", "scale"]) {
            expect(kinds).toContain(kind);
        }
    });

    it("accepts tokens, custom property definitions, 0, 1 and percentages", () => {
        expect(
            scan({
                "a.css": [
                    ":root {",
                    "    --panel-width: 320px;",
                    "}",
                    ".a {",
                    "    padding: var(--paper-uigap);",
                    "    width: 100%;",
                    "    opacity: 1;",
                    "    flex: 1;",
                    "    margin: 0;",
                    "    border: 1px solid var(--paper-border);",
                    "    transform: scale(1);",
                    "    transition: opacity var(--paper-short-transition) var(--paper-ease-standard);",
                    "}",
                ].join("\n"),
            }),
        ).toEqual([]);
    });

    it("flags inline TSX literals but not computed pixels or getVar fallbacks", () => {
        const found = scan({
            "a.tsx": [
                'padding: "12px",',
                '"z-index": 100,',
                "left: `${x}px`,",
                'const c = getVar("primary", "#2981e5");',
            ].join("\n"),
        });
        expect(found.map((l) => l.split(": ").slice(0, 2).join(": "))).toEqual(["/a.tsx:1: size", "/a.tsx:2: z-index"]);
    });

    it("honours paper-literal-ok on a line, after a comment, and per file", () => {
        expect(
            scan({
                "a.css": [
                    "font-size: 7px; /* paper-literal-ok: svg units */",
                    "/* paper-literal-ok: svg units */",
                    "font-size: 7px;",
                    "width: 9px;",
                    "",
                    "height: 3px;",
                ].join("\n"),
            }).map((l) => l.split(": ")[0]),
        ).toEqual(["/a.css:6"]);
        expect(scan({ "b.css": "/* paper-literal-ok-file: data */\n.a { width: 9px; }" })).toEqual([]);
    });
});
