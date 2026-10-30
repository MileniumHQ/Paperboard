// Terraria's message of the day in the shared MOTD editor: colours become
// chat tags, and anything the editor can't show reaches the game unchanged.
import { expect, test } from "bun:test";
import { parseMotd, plainStyle, replaceRange } from "../src/core/motd";
import { terrariaMotd } from "../src/games/terraria/motd";

const text = (doc: { ch: string }[]) => doc.map((c) => c.ch).join("");

test("colour tags read as colours and write back as the same tags", () => {
    const raw = "Welcome to [c/FF5555:Hardmode] and [c/55ff55:friends]!";
    const [line] = parseMotd(raw, terrariaMotd);
    expect(line.map((s) => [s.text, s.color])).toEqual([
        ["Welcome to ", undefined],
        ["Hardmode", "c"],
        [" and ", undefined],
        ["friends", "a"],
        ["!", undefined],
    ]);
    expect(terrariaMotd.serialize(terrariaMotd.parse(raw))).toBe("Welcome to [c/FF5555:Hardmode] and [c/55FF55:friends]!");
});

test("other tags and off-palette colours stay as text and round-trip exactly", () => {
    const raw = "Bring [i:29] and [c/123456:custom] [g:4]";
    const doc = terrariaMotd.parse(raw);
    expect(doc.every((cell) => cell.style.color === undefined)).toBe(true);
    expect(terrariaMotd.serialize(doc)).toBe(raw);
});

test("a ] inside coloured text is written outside the tag so the tag can't close early", () => {
    const doc = [..."a]b"].map((ch) => ({ ch, style: plainStyle("c") }));
    const raw = terrariaMotd.serialize(doc);
    expect(raw).toBe("[c/FF5555:a]][c/FF5555:b]");
    expect(text(terrariaMotd.parse(raw))).toBe("a]b");
});

test("the message is one line: pasted line breaks become spaces", () => {
    const pasted = terrariaMotd.parse("one\ntwo");
    const { doc } = replaceRange([], 0, 0, pasted, terrariaMotd);
    expect(text(doc)).toBe("one two");
    expect(terrariaMotd.serialize(doc)).toBe("one two");
});
