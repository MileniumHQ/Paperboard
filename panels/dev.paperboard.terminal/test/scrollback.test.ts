import { describe, expect, test } from "bun:test";
import { SCROLLBACK_CHARS, appendOutput, appendSize, parseScrollback, readWholeLines, scrollbackText, type Scrollback } from "../src/lib/scrollback";

// Tab Output reads whole lines: a full buffer's first line was cut short by
// the cap, and only that one is left out.
describe("a full scrollback's last lines", () => {
    test("are as many whole lines as asked for, less only the line the cap cut short", () => {
        const line = (n: number) => `line ${String(n).padStart(6, "0")} ${"x".repeat(400)}`;
        const count = Math.ceil(SCROLLBACK_CHARS / line(0).length) + 10;
        const full = Array.from({ length: count }, (_, n) => line(n)).join("\n").slice(-SCROLLBACK_CHARS);
        const all = full.split("\n");

        const last = readWholeLines(full, 100).split("\n");
        expect(last).toEqual(all.slice(-100));
        expect(last.at(-1)).toBe(line(count - 1));

        // asked for more lines than it holds: the severed head is not one of them
        expect(all[0]).not.toBe(line(count - all.length));
        expect(readWholeLines(full, all.length + 5).split("\n")).toEqual(all.slice(1));
    });
});

// A shell's output is kept in runs by the size its screen was, so a screen
// shown again replays each at its size.
describe("a scrollback's sizes", () => {
    test("each run holds what was printed at one size; a size nothing was printed at is dropped", () => {
        const screen: Scrollback = [{ cols: 80, rows: 24, text: "" }];
        appendOutput(screen, "wide ");
        appendSize(screen, 40, 24);
        appendSize(screen, 60, 24);
        appendOutput(screen, "middle ");
        appendSize(screen, 60, 24);
        appendOutput(screen, "still");
        expect(screen).toEqual([
            { cols: 80, rows: 24, text: "wide " },
            { cols: 60, rows: 24, text: "middle still" },
        ]);
        // back to the size it was printed at, after a size nothing was printed at
        appendSize(screen, 40, 24);
        appendSize(screen, 60, 24);
        expect(screen.length).toBe(2);
    });

    test("past the cap, the oldest output goes, whole runs first", () => {
        const screen: Scrollback = [];
        appendSize(screen, 80, 24);
        appendOutput(screen, "a".repeat(10));
        appendSize(screen, 40, 24);
        appendOutput(screen, "b".repeat(SCROLLBACK_CHARS - 5));
        appendSize(screen, 60, 24);
        appendOutput(screen, "c".repeat(10));
        expect(scrollbackText(screen).length).toBe(SCROLLBACK_CHARS);
        expect(screen.map((r) => [r.cols, r.text.length])).toEqual([
            [40, SCROLLBACK_CHARS - 10],
            [60, 10],
        ]);
    });

    test("is saved and read back as it was, and a file that isn't one is refused", () => {
        const screen: Scrollback = [{ text: "from before sizes" }, { cols: 80, rows: 24, text: "now" }];
        expect(parseScrollback(JSON.stringify(screen))).toEqual(screen);
        expect(() => parseScrollback("plain text")).toThrow();
        expect(() => parseScrollback(JSON.stringify([{ cols: 80, text: "half a size" }]))).toThrow("isn't a saved screen");
    });
});
