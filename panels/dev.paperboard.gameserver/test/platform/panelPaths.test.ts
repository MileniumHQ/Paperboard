import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir, writeTree } from "../helpers/tmp";
import { isListableDirArg } from "../../src/core/dirs";
import { isLogFileName } from "../../src/core/logs";
import { assertCreatableWorldName, assertShellSafeLevelName } from "../../src/core/worlds";
import { listServerFiles, readServerFile, writeServerFile } from "../../src/service/serverFiles";
import { trashRemovePathsWith } from "../../src/service/trash";

const TRAVERSALS = ["..", "../x", "a/../../x", "/etc", "/", "//server", "a//b", "a/", "/a", "a\\b", "..\\x", "C:\\x", "C:/x", ".", "./a"];

/** a server folder beside a secret file outside it */
function serverWithNeighbour() {
    const parent = tempDir("gameserver-paths-");
    const root = path.join(parent, "server");
    writeTree(parent, { "secret.txt": "outside", "server/server.properties": "motd=x\n", "server/logs/latest.log": "log", "server/world/level.dat": "level" });
    return { root, parent, deps: { serverDir: async () => root } };
}

// Panel paths stay inside the server folder.
describe("panel paths", () => {
    test("listing, log, world and level names refuse traversal, absolute paths, // and backslashes; the root listing is accepted", () => {
        for (const bad of TRAVERSALS) {
            expect([bad, isListableDirArg(bad)]).toEqual([bad, false]);
            expect([bad, isLogFileName(bad)]).toEqual([bad, false]);
            expect(() => assertShellSafeLevelName(bad)).toThrow("Refusing");
            expect(() => assertCreatableWorldName(bad)).toThrow("Refusing");
        }
        expect(isListableDirArg("")).toBe(true);
        expect(isListableDirArg("world/dimensions/minecraft/overworld")).toBe(true);
        expect(isLogFileName("latest.log")).toBe(true);
        expect(isLogFileName("2026-01-01-1.log.gz")).toBe(true);
        for (const shell of ["world;rm -rf ~", "world`id`", "$(id)", "world|x", "world&x", "world\nx"]) {
            expect(() => assertShellSafeLevelName(shell)).toThrow("Refusing");
        }
        expect(assertShellSafeLevelName("My World (1)")).toBe("My World (1)");
    });

    test("the Files tab and trash refuse every traversal before touching the disk", async () => {
        const { root, parent, deps } = serverWithNeighbour();
        expect((await listServerFiles("", deps)).entries.map((e) => e.name)).toEqual(["logs", "world", "server.properties"]);
        for (const bad of TRAVERSALS) {
            await expect(listServerFiles(bad, deps)).rejects.toThrow("Not a folder path Paperboard can open");
            await expect(readServerFile(bad, deps)).rejects.toThrow("Not a file path Paperboard can open");
            await expect(writeServerFile(bad, "x", "0".repeat(64), false, deps)).rejects.toThrow("Not a file path Paperboard can open");
            await expect(trashRemovePathsWith({ getServerDir: async () => root }, [bad])).rejects.toThrow("Refusing to trash unsafe path");
        }
        await expect(trashRemovePathsWith({ getServerDir: async () => root }, [""])).rejects.toThrow("Refusing to trash unsafe path");
        await expect(trashRemovePathsWith({ getServerDir: async () => root }, ["world"], "../.trash-1")).rejects.toThrow("Refusing unsafe trash directory");
        expect(fs.readFileSync(path.join(parent, "secret.txt"), "utf8")).toBe("outside");
        expect(fs.existsSync(path.join(root, "world", "level.dat"))).toBe(true);
    });

    test("the Files tab refuses any path through a link", async () => {
        const { root, parent, deps } = serverWithNeighbour();
        fs.mkdirSync(path.join(parent, "elsewhere"));
        fs.writeFileSync(path.join(parent, "elsewhere", "passwords.txt"), "hunter2");
        // a directory link: a junction on Windows, which needs no special rights; a symlink elsewhere
        fs.symlinkSync(path.join(parent, "elsewhere"), path.join(root, "plugins"), process.platform === "win32" ? "junction" : "dir");
        const version = "0".repeat(64);
        await expect(listServerFiles("plugins", deps)).rejects.toThrow("goes through a link");
        await expect(readServerFile("plugins/passwords.txt", deps)).rejects.toThrow("goes through a link");
        await expect(writeServerFile("plugins/passwords.txt", "x", version, false, deps)).rejects.toThrow("goes through a link");
        // the root listing does not offer the link either
        const listing = await listServerFiles("", deps);
        expect(listing.entries.map((e) => e.name)).not.toContain("plugins");
        expect(fs.readFileSync(path.join(parent, "elsewhere", "passwords.txt"), "utf8")).toBe("hunter2");
    });
});
