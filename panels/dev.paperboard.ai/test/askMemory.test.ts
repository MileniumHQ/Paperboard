// What Ask AI keeps per memory key: whole exchanges, newest first to stay.
import { describe, expect, it } from "bun:test";
import { evictMemories, MAX_MEMORIES, MAX_MEMORY_CHARS, MAX_MEMORY_MESSAGES, memoryKey, remember } from "../src/core/askMemory";

describe("ask memory", () => {
    it("keeps the newest exchanges whole", () => {
        let history = remember([], "q0", "a0");
        for (let i = 1; i < MAX_MEMORY_MESSAGES; i++) history = remember(history, `q${i}`, `a${i}`);
        expect(history).toHaveLength(MAX_MEMORY_MESSAGES);
        expect(history[0]).toEqual({ role: "user", content: `q${MAX_MEMORY_MESSAGES / 2}` });
        expect(history.at(-1)).toEqual({ role: "assistant", content: `a${MAX_MEMORY_MESSAGES - 1}` });
    });

    it("drops old exchanges to stay within the character budget", () => {
        const half = "x".repeat(MAX_MEMORY_CHARS / 2);
        const history = remember(remember([], "a", half), "b", half);
        expect(history.map((m) => m.content)).toEqual(["b", half]);
    });

    it("cuts a single exchange larger than the budget to its newest part", () => {
        const history = remember([], "q".repeat(MAX_MEMORY_CHARS), "a".repeat(MAX_MEMORY_CHARS * 2));
        expect(history.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
        expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    });

    it("forgets the least recently used key past the limit", () => {
        const entries = Object.fromEntries(Array.from({ length: MAX_MEMORIES + 1 }, (_, i) => [`k${i}`, { messages: [], updatedAt: i }]));
        const kept = evictMemories(entries);
        expect(Object.keys(kept)).toHaveLength(MAX_MEMORIES);
        expect("k0" in kept).toBe(false);
    });

    it("needs a key of bounded length", () => {
        expect(memoryKey("  channel-1 ")).toBe("channel-1");
        expect(() => memoryKey(" ")).toThrow("required");
        expect(() => memoryKey("k".repeat(201))).toThrow("limited to 200");
    });
});
