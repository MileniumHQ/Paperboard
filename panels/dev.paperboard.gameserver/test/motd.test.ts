// The Overview's server list message: § codes render instead of being
// stripped, and the editor writes back what the game reads.
import { describe, expect, mock, test } from "bun:test";

let propertiesFile: string | null = null;
mock.module("@mileniumhq/paperapi", () => ({
    config: { get: async () => ({}) },
    files: { read: async () => propertiesFile },
    system: { getLocalIP: async () => "127.0.0.1" },
}));

const { applyCode, docFromMotd, MAX_MOTD_CHARS, motdFromDoc, parseMotd, replaceRange, styleAt } = await import(
    "../src/core/motd"
);
const { loadConfigAndProperties } = await import("../src/service/config");

const text = (doc: { ch: string }[]) => doc.map((c) => c.ch).join("");

describe("parseMotd", () => {
    test("a color resets formatting, a format adds to it, §r returns to the default", () => {
        const [line] = parseMotd("§lA§6B§oC§rD");
        expect(line.map((s) => [s.text, s.color, s.bold, s.italic])).toEqual([
            ["A", undefined, true, false],
            ["B", "6", false, false],
            ["C", "6", false, true],
            ["D", undefined, false, false],
        ]);
    });

    test("lines split on newlines; unknown and dangling codes are dropped", () => {
        const lines = parseMotd("§zone\n§Btwo§");
        expect(lines.map((line) => line.map((s) => s.text).join(""))).toEqual(["one", "two"]);
        expect(lines[1][0].color).toBe("b");
    });
});

describe("the editor's doc", () => {
    test("round-trips through the fewest codes", () => {
        for (const raw of ["§6Gold §lbold\n§rplain", "§b§lJoin with §cfriends", "plain", ""]) {
            expect(motdFromDoc(docFromMotd(raw))).toBe(raw);
        }
        // a redundant code is dropped, a style carries across the line break
        expect(motdFromDoc(docFromMotd("§6§6a\nb"))).toBe("§6a\nb");
    });

    test("a code applies to a selection without touching the text around it", () => {
        const doc = docFromMotd("§bHello world");
        expect(motdFromDoc(applyCode(doc, 6, 11, "c"))).toBe("§bHello §cworld");
        const bold = applyCode(doc, 0, 5, "l");
        expect(motdFromDoc(bold)).toBe("§b§lHello§b world");
        // a format every character has toggles off
        expect(motdFromDoc(applyCode(bold, 0, 5, "l"))).toBe("§bHello world");
        expect(motdFromDoc(applyCode(doc, 0, 11, "r"))).toBe("Hello world");
    });

    test("typing takes the caret's style", () => {
        const doc = docFromMotd("§aA\n§cB");
        expect(styleAt(doc, 1).color).toBe("a");
        expect(styleAt(doc, 2).color).toBe("c");
        expect(styleAt([], 0).color).toBeUndefined();
    });

    test("keeps two lines and a bounded length", () => {
        const doc = docFromMotd("a\nb");
        const extra = replaceRange(doc, 3, 3, docFromMotd("\nc"));
        expect(text(extra.doc)).toBe("a\nb c");
        expect(extra.caret).toBe(5);
        const long = replaceRange([], 0, 0, docFromMotd("x".repeat(MAX_MOTD_CHARS + 10)));
        expect(long.doc.length).toBe(MAX_MOTD_CHARS);
        expect(text(replaceRange(doc, 0, 2, []).doc)).toBe("b");
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
