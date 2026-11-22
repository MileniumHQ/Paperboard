// The small helpers every panel reaches for, page and service alike.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWriteFileAtomicTemp, writeFileAtomic, writeFileAtomicSync } from "../src/fs";

describe("writeFileAtomic", () => {
    const dirs: string[] = [];
    const tempDir = () => {
        const dir = mkdtempSync(join(tmpdir(), "paperapi-atomic-"));
        dirs.push(dir);
        return dir;
    };
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    for (const [name, write] of [
        ["async", writeFileAtomic],
        ["sync", async (...args: Parameters<typeof writeFileAtomicSync>) => writeFileAtomicSync(...args)],
    ] as const) {
        test(`${name}: replaces the file whole, makes its folder, and sets the mode asked for exactly`, async () => {
            const dir = tempDir();
            const file = join(dir, "deep", "settings.json");
            await write(file, "old");
            await write(file, new TextEncoder().encode("new"), { mode: 0o100600 });
            expect(readFileSync(file, "utf8")).toBe("new");
            expect(readdirSync(join(dir, "deep"))).toEqual(["settings.json"]);
            if (process.platform !== "win32") expect(statSync(file).mode & 0o7777).toBe(0o600);
        });

        test(`${name}: a write that fails throws its own error and leaves what was there, with no temp file`, async () => {
            const dir = tempDir();
            // a folder in the file's place: the rename over it fails
            const file = join(dir, "taken");
            mkdirSync(file);
            writeFileSync(join(file, "inside"), "kept");
            await expect(write(file, "new")).rejects.toThrow(/EISDIR|ENOTEMPTY|EPERM|EEXIST|EACCES/);
            expect(readdirSync(dir)).toEqual(["taken"]);
            expect(readFileSync(join(file, "inside"), "utf8")).toBe("kept");
        });
    }

    test("its temp files are told apart from the files beside them", async () => {
        const file = join(tempDir(), "server.properties");
        // the name the write lands under first, seen as it is renamed into place
        const renamed: string[] = [];
        const rename = fsp.rename;
        fsp.rename = (async (from: string, to: string) => {
            renamed.push(from);
            return rename(from, to);
        }) as typeof fsp.rename;
        try {
            await writeFileAtomic(file, "motd=Hi");
        } finally {
            fsp.rename = rename;
        }
        expect(renamed).toHaveLength(1);
        expect(isWriteFileAtomicTemp(renamed[0]!)).toBe(true);
        expect(isWriteFileAtomicTemp(file)).toBe(false);
        for (const name of ["notes.tmp", "a.0123456789ab.tmp.bak", "a.0123456789AB.tmp"]) expect(isWriteFileAtomicTemp(name)).toBe(false);
    });
});
