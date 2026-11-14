import { describe, expect, test } from "bun:test";
import { SCROLLBACK_CHARS, readWholeLines } from "../src/lib/scrollback";

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
