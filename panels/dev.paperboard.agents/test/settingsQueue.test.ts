import { describe, expect, test } from "bun:test";
import type { Settings } from "../src/contract";
import { createSettingsQueue } from "../src/lib/settingsQueue";

const base: Settings = { name: "Ada", harness: "codex", model: null, compaction: "summarize" };

/** a service that keeps the settings as a whole, like the real one, with a write that takes a moment */
function service() {
    let saved = base;
    const writes: Settings[] = [];
    const queue = createSettingsQueue({
        current: () => saved,
        write: async (s) => {
            await new Promise((r) => setTimeout(r, 5));
            writes.push(s);
            saved = s;
        },
        refresh: async () => {},
    });
    return { queue, writes, saved: () => saved };
}

describe("settings queue", () => {
    test("two quick changes in different sections both survive", async () => {
        const s = service();
        await Promise.all([
            s.queue((cur) => ({ ...cur, compaction: "forget" })),
            s.queue((cur) => ({ ...cur, automationInstructions: "Be brief." })),
            s.queue((cur) => ({ ...cur, name: "Grace" })),
        ]);
        expect(s.saved()).toEqual({ ...base, compaction: "forget", automationInstructions: "Be brief.", name: "Grace" });
        expect(s.writes).toHaveLength(3);
    });

    test("a change with nothing to change writes nothing", async () => {
        const s = service();
        await s.queue(() => null);
        expect(s.writes).toHaveLength(0);
    });

    test("a refused save is the caller's, and the next one still goes", async () => {
        let saved = base;
        let attempts = 0;
        const queue = createSettingsQueue({
            current: () => saved,
            write: async (next) => {
                attempts++;
                if (attempts === 1) throw new Error("not ready");
                saved = next;
            },
            refresh: async () => {},
        });
        const first = queue((cur) => ({ ...cur, name: "A" }));
        const second = queue((cur) => ({ ...cur, compaction: "forget" }));
        await expect(first).rejects.toThrow("not ready");
        await second;
        expect(saved).toEqual({ ...base, compaction: "forget" });
    });

    test("settings that aren't loaded yet are an error, not a guess", async () => {
        const queue = createSettingsQueue({ current: () => null, write: async () => {}, refresh: async () => {} });
        await expect(queue((cur) => cur)).rejects.toThrow("aren't loaded");
    });
});
