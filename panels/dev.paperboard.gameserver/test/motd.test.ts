// The Overview's server list message: § codes render instead of being
// stripped, and the editor writes back what the game reads.
import { describe, expect, mock, test } from "bun:test";

let propertiesFile: string | null = null;
mock.module("@mileniumhq/paperapi", () => ({
    config: { get: async () => ({}) },
    files: { read: async () => propertiesFile },
    system: { getLocalIP: async () => "127.0.0.1" },
}));

const { applyMotdCode, joinMotdLines, parseMotd, splitMotdLines } = await import("../src/core/motd");
const { loadConfigAndProperties } = await import("../src/service/config");

describe("parseMotd", () => {
    test("a color resets formatting, a format adds to it, §r returns to the default", () => {
        const [line] = parseMotd("§lA§6B§oC§rD");
        expect(line.map((s) => [s.text, s.color, s.bold, s.italic])).toEqual([
            ["A", undefined, true, false],
            ["B", "#FFAA00", false, false],
            ["C", "#FFAA00", false, true],
            ["D", undefined, false, false],
        ]);
    });

    test("lines split on newlines; unknown and dangling codes are dropped", () => {
        const lines = parseMotd("§zone\n§Btwo§");
        expect(lines.map((line) => line.map((s) => s.text).join(""))).toEqual(["one", "two"]);
        expect(lines[1][0].color).toBe("#55FFFF");
    });
});

describe("editing", () => {
    test("a code wraps a selection, or goes in at the caret", () => {
        expect(applyMotdCode("Hello world", 6, 11, "a")).toEqual({ value: "Hello §aworld§r", caret: 15 });
        // the text after the selection keeps the style it had
        expect(applyMotdCode("§b§lJoin with friends", 14, 21, "c").value).toBe("§b§lJoin with §cfriends§b§l");
        expect(applyMotdCode("Hello", 0, 0, "l")).toEqual({ value: "§lHello", caret: 2 });
    });

    test("two lines in the editor, one newline-joined value on disk", () => {
        expect(splitMotdLines("only")).toEqual(["only", ""]);
        expect(joinMotdLines(["only", ""])).toBe("only");
        expect(joinMotdLines(splitMotdLines("a\nb"))).toBe("a\nb");
        expect(joinMotdLines(["", ""])).toBe("");
    });
});

describe("the service's MOTD", () => {
    const load = async (file: string) => {
        propertiesFile = file;
        let patch: Record<string, unknown> = {};
        await loadConfigAndProperties({ state: {}, setState: (p: Record<string, unknown>) => (patch = p) } as any);
        return patch.serverMotd;
    };

    test("keeps its codes, shows an emptied message as empty, defaults when missing", async () => {
        expect(await load("motd=\\u00A76Gold\\nTwo\n")).toBe("§6Gold\nTwo");
        expect(await load("motd=\n")).toBe("");
        expect(await load("server-port=25565\n")).toBe("A Minecraft Server");
    });
});
