// Directory-argument boundary (bun test): the lister accepts the panel root
// ("") and one safe segment, and refuses traversal/absolute/nested paths.
// Regression test for the server-root listing being silently rejected
// (isValidEntryName("") is false), which made the world manager see zero
// worlds.
import { describe, test, expect } from "bun:test";
import { isListableDirArg, isValidEntryName, windowsDirArgs } from "../src/core/dirs";

describe("isListableDirArg", () => {
    test("accepts the panel root", () => {
        expect(isListableDirArg("")).toBe(true);
    });

    test("accepts one safe segment", () => {
        expect(isListableDirArg("world")).toBe(true);
        expect(isListableDirArg("dev.paperboard.terminal")).toBe(true);
        expect(isListableDirArg("my world_2")).toBe(true);
        // Modrinth jar names contain '+'
        expect(isListableDirArg("voicechat-fabric-2.6.23+26.2.jar")).toBe(true);
    });

    test("accepts nested safe paths (region directories)", () => {
        expect(
            isListableDirArg("world/dimensions/minecraft/overworld/region"),
        ).toBe(true);
        expect(isListableDirArg("world2/region")).toBe(true);
    });

    test("refuses traversal, absolute paths, empty segments, non-strings", () => {
        for (const bad of [
            "..",
            "../evil",
            "a/../b",
            "a//b",
            "a/",
            "/a",
            "a\\b",
            ".",
            " leading",
            undefined,
            null,
            42,
        ]) {
            expect(isListableDirArg(bad)).toBe(false);
        }
    });
});

describe("isValidEntryName", () => {
    test("empty and traversal are not entry names", () => {
        expect(isValidEntryName("")).toBe(false);
        expect(isValidEntryName("..")).toBe(false);
        expect(isValidEntryName("level.dat")).toBe(true);
    });
});

describe("windowsDirArgs", () => {
    test("lists files as well as directories", () => {
        const args = windowsDirArgs("C:\\data\\logs");
        // `/a:d` (directories only) hid every log/jar/stats file on Windows
        expect(args).toContain("/a:-l-h");
        expect(args).not.toContain("/a:d-l-h");
        expect(args.at(-1)).toBe("C:\\data\\logs");
    });
});
