// The Options, Advanced, Worlds and MOTD editors all write server.properties
// through writeServerProperties, which merges the edit into the current file.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createSignal } from "solid-js";

const [serverVersion, setServerVersion] = createSignal("");
mock.module("../src/lib/server", () => ({ serverVersion, setServerVersion }));

let readResult: () => Promise<string | null>;
const writes: string[] = [];
mock.module("@mileniumhq/paperapi", () => ({
    fileApi: {
        read: () => readResult(),
        write: async (_path: string, content: string) => {
            writes.push(content);
        },
    },
}));

const { writeServerProperties } = await import("../src/lib/properties");
const { parseProperties } = await import("../src/core/properties");

beforeEach(() => {
    writes.length = 0;
});

describe("writeServerProperties", () => {
    test("an unreadable file is not overwritten with only the edited keys", async () => {
        readResult = async () => {
            throw new Error("EACCES");
        };
        await expect(writeServerProperties({ motd: "hi" })).rejects.toThrow("EACCES");
        expect(writes).toEqual([]);
    });

    test("the edit merges into the existing file; a missing file starts empty", async () => {
        readResult = async () => "server-port=25570\nmotd=old\n";
        await writeServerProperties({ motd: "new" });
        expect(parseProperties(writes[0])).toEqual({ "server-port": "25570", motd: "new" });

        readResult = async () => null;
        await writeServerProperties({ motd: "first" });
        expect(parseProperties(writes[1])).toEqual({ motd: "first" });
    });

    test("color codes and other non-ASCII text are written as \\u escapes", async () => {
        readResult = async () => null;
        await writeServerProperties({ motd: "§6Gold\n§bCafé ✨" });
        // pure ASCII on disk, so a Latin-1 reader gets the same text back
        expect(writes[0]).toMatch(/^[\x00-\x7f]*$/);
        expect(writes[0]).toContain("\\u00A76Gold");
        expect(parseProperties(writes[0]).motd).toBe("§6Gold\n§bCafé ✨");
    });
});
