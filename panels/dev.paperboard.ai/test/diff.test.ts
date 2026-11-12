// An agent's edit as removed and added lines, with a little context.
import { describe, expect, it } from "bun:test";
import { editLines, MAX_DIFF_LINES } from "../src/core/diff";

describe("edit view", () => {
    it("shows the changed lines between their unchanged neighbours", () => {
        const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
        const after = ["a", "b", "c", "d", "E", "f", "g", "h"].join("\n");
        expect(editLines(before, after).lines).toEqual([
            { kind: "context", text: "b" },
            { kind: "context", text: "c" },
            { kind: "context", text: "d" },
            { kind: "removed", text: "e" },
            { kind: "added", text: "E" },
            { kind: "context", text: "f" },
            { kind: "context", text: "g" },
            { kind: "context", text: "h" },
        ]);
    });

    it("shows a new file as all added", () => {
        expect(editLines(null, "x\ny").lines).toEqual([
            { kind: "added", text: "x" },
            { kind: "added", text: "y" },
        ]);
    });

    it("counts the lines it leaves out of a huge rewrite", () => {
        const after = Array.from({ length: MAX_DIFF_LINES + 5 }, (_, i) => `line ${i}`).join("\n");
        const view = editLines(null, after);
        expect(view.lines.filter((l) => l.kind === "added")).toHaveLength(MAX_DIFF_LINES);
        expect(view.hidden).toBe(5);
    });
});
