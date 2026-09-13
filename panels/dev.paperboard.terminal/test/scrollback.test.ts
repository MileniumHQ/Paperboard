import { describe, it, expect } from "bun:test";
import {
    SCROLLBACK_CHARS,
    applyScrollbackCap,
    readWholeLines,
} from "../src/lib/scrollback";

describe("applyScrollbackCap", () => {
    it("appends without exceeding the cap", () => {
        let buf = "";
        for (let i = 0; i < 1300; i++) {
            buf = applyScrollbackCap("x", buf);
        }
        expect(buf.length).toBeLessThanOrEqual(SCROLLBACK_CHARS);
        expect(buf).toBe("x".repeat(1300));
    });

    it("keeps the most recent content when saturated", () => {
        const buf = applyScrollbackCap("N-E-W", "a".repeat(SCROLLBACK_CHARS));
        expect(buf.length).toBe(SCROLLBACK_CHARS);
        expect(buf.endsWith("N-E-W")).toBe(true);
    });
});

describe("readWholeLines", () => {
    it("returns the last N whole lines", () => {
        const buf = "l1\nl2\nl3\nl4\n";
        expect(readWholeLines(buf, 2)).toBe("l3\nl4");
    });

    it("falls back to 100 lines, clamps 1..1000", () => {
        const buf = Array.from({ length: 300 }, (_, i) => `l${i}`).join("\n") + "\n";
        expect(readWholeLines(buf, undefined as unknown as number).split("\n")[0]).toContain("l2");
        expect(readWholeLines(buf, 0).split("\n")).toHaveLength(1);
        const maxed = readWholeLines(buf, 5000);
        expect(maxed.split("\n")).toHaveLength(300);
    });

    it("drops a mid-command head fragment once the buffer is saturated", () => {
        // saturated buffer whose head line was cut in half by the cap
        const poison = "artial command output line\n" + Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n") + "\n";
        const buf = "x".repeat(SCROLLBACK_CHARS - poison.length + 28) + poison; // 28 raw padding chars
        const lines = readWholeLines(buf, 100).split("\n");
        // the severed fragment ("artial command output line") must not
        // appear as a standalone line
        for (const line of lines) {
            expect(line.startsWith("artial")).toBe(false);
        }
        expect(lines).toContain("l0");
    });

    it("never severs output when the buffer is fresh", () => {
        const buf = "full first line\nsecond line";
        expect(readWholeLines(buf, 10)).toBe("full first line\nsecond line");
    });

    it("handles empty buffers", () => {
        expect(readWholeLines("", 5)).toBe("");
    });
});
