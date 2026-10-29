// The Overview's server list message: § codes render instead of being
// stripped, and the editor writes back what the game reads.
import { describe, expect, mock, test } from "bun:test";
import { portApiStub } from "./portApiStub";
import { readFileSync } from "node:fs";

let propertiesFile: string | null = null;
mock.module("@mileniumhq/paperapi", () => ({
    portApi: portApiStub(),
    config: { get: async () => ({}) },
    files: { read: async () => propertiesFile },
    system: { getLocalIP: async () => "127.0.0.1" },
}));

const { applyCode, docFromMotd, MAX_MOTD_CHARS, MOTD_COLORS, motdColorCss, motdFromDoc, parseMotd, replaceRange, styleAt } = await import(
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

describe("the MOTD stylesheet", () => {
    const css = readFileSync(new URL("../src/components/Motd.module.css", import.meta.url), "utf8");

    test("draws every colour code from the table, as a light/dark pair", () => {
        for (const color of MOTD_COLORS) {
            expect(css).toContain(`.color-${color.code} {\n    color: ${motdColorCss(color)};\n}`);
        }
        // uncoloured text is the list's gray, §7
        const gray = MOTD_COLORS.find((c) => c.code === "7")!;
        expect(css).toContain(`.plain {\n    color: ${motdColorCss(gray)};\n}`);
    });

    // PaperUI's own surfaces, read from its stylesheet: the message sits on a card
    const paperColors = readFileSync(new URL("../../../packages/paperui/src/styles/colors.css", import.meta.url), "utf8");
    const surfaces = (block: string) => {
        const body = paperColors.slice(paperColors.indexOf(block));
        const value = (name: string) => body.match(new RegExp(`--paper-${name}: (#[0-9a-f]{6});`))![1];
        return ["surface", "surface-raised"].map(value);
    };

    const srgbLuminance = (hex: string) =>
        [1, 3, 5]
            .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
            .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

    // OKLCH to linear sRGB (clipped into gamut, as the browser draws it)
    const oklchLuminance = (css: string) => {
        const [L, C, h] = css.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)!.slice(1).map(Number);
        const a = C * Math.cos((h * Math.PI) / 180);
        const b = C * Math.sin((h * Math.PI) / 180);
        const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
        const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
        const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
        const rgb = [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ].map((c) => Math.min(1, Math.max(0, c)));
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };

    const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

    test("every colour reads on PaperUI's light and dark surfaces", () => {
        const themes = [
            { theme: "light", surfaces: surfaces(":root {") },
            { theme: "dark", surfaces: surfaces('[data-theme="dark"] {') },
        ] as const;
        for (const { theme, surfaces: backgrounds } of themes) {
            for (const color of MOTD_COLORS) {
                for (const background of backgrounds) {
                    const ratio = contrast(oklchLuminance(color[theme]), srgbLuminance(background));
                    expect({ color: color.name, theme, background, readable: ratio >= 4 }).toEqual({
                        color: color.name,
                        theme,
                        background,
                        readable: true,
                    });
                }
            }
        }
    });
});
