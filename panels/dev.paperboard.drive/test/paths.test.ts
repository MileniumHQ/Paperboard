// Nothing the page or a flow sends reaches outside the drive: not by "..",
// not by an absolute path, not through a link, and not by a name that is
// really a path.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Drive, nameProblem, pathParts, within } from "../src/lib/drive";
import { openDrive } from "./helpers/drive";

const ESCAPES = ["..", "../outside", "a/../../outside", "./a", "a/./b", "a//b", "a/", "/etc/passwd", "\\etc", "C:\\Windows", "C:/Windows", "a\0b"];

describe("paths", () => {
    test("a path is its parts, and every way out of the drive is refused", () => {
        expect(pathParts("")).toEqual([]);
        expect(pathParts("Photos/2024/beach.jpg")).toEqual(["Photos", "2024", "beach.jpg"]);
        for (const bad of ESCAPES) expect(() => pathParts(bad), bad).toThrow();
        expect(() => pathParts(42)).toThrow("A path is text.");
    });

    test("names that are really paths, or nothing, are refused", () => {
        for (const bad of ["", "   ", ".", "..", "a/b", "a\\b", "a\0b", "tab\there", "x".repeat(256), "é".repeat(128)]) {
            expect(nameProblem(bad), JSON.stringify(bad)).not.toBeNull();
        }
        for (const good of ["notes.md", ".env", "Résumé 2026.pdf", "x".repeat(255), "photo (1).jpg"]) expect(nameProblem(good)).toBeNull();
    });

    test("every call refuses a path that leaves the drive", async () => {
        const { drive, outside } = await openDrive();
        fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
        for (const bad of ["..", "../outside", "../outside/secret.txt", "/etc"]) {
            await expect(drive.list(bad)).rejects.toThrow();
            await expect(drive.stat(bad)).rejects.toThrow();
            await expect(drive.read(bad, 0)).rejects.toThrow();
            await expect(drive.readText(bad)).rejects.toThrow();
            await expect(drive.createFolder(bad, "x")).rejects.toThrow();
            await expect(drive.rename(bad, "x")).rejects.toThrow();
            await expect(drive.delete([bad])).rejects.toThrow();
            await expect(drive.move([bad], "")).rejects.toThrow();
            await expect(drive.writeText(bad, "x")).rejects.toThrow();
            await expect(drive.uploadBegin(bad, "x", 1)).rejects.toThrow();
        }
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
        expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
    });

    test("a link out of the drive is not part of it: not listed, read, written through, or deleted through", async () => {
        const { drive, root, outside, put } = await openDrive();
        fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
        put("notes.md", "# Notes");
        fs.symlinkSync(outside, path.join(root, "away"));
        fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "secret.txt"));

        expect((await drive.list("")).map((e) => e.name)).toEqual(["notes.md"]);
        await expect(drive.list("away")).rejects.toThrow("leads outside the drive");
        await expect(drive.read("secret.txt", 0)).rejects.toThrow("leads outside the drive");
        await expect(drive.readText("away/secret.txt")).rejects.toThrow("leads outside the drive");
        await expect(drive.writeText("secret.txt", "overwritten")).rejects.toThrow("leads outside the drive");
        await expect(drive.writeText("away/new.txt", "x")).rejects.toThrow("leads outside the drive");
        await expect(drive.createFolder("away", "x")).rejects.toThrow("leads outside the drive");
        await expect(drive.delete(["away"])).rejects.toThrow("leads outside the drive");
        await expect(drive.move(["notes.md"], "away")).rejects.toThrow("leads outside the drive");
        await expect(drive.uploadBegin("away", "x.txt", 1)).rejects.toThrow("leads outside the drive");

        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
        expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
        expect(fs.existsSync(path.join(root, "notes.md"))).toBe(true);
    });

    test("a link that stays inside the drive is followed like any folder", async () => {
        const { drive, root, put } = await openDrive();
        put("Photos/beach.jpg", "jpg");
        fs.symlinkSync(path.join(root, "Photos"), path.join(root, "Pictures"));
        expect((await drive.list("Pictures")).map((e) => e.path)).toEqual(["Pictures/beach.jpg"]);
    });

    test("names a path can't carry are refused before anything is made", async () => {
        const { drive, root, put } = await openDrive();
        put("a.txt", "a");
        for (const bad of ["", "..", "a/b", "a\\b", "x".repeat(256)]) {
            await expect(drive.createFolder("", bad)).rejects.toThrow();
            await expect(drive.rename("a.txt", bad)).rejects.toThrow();
            await expect(drive.uploadBegin("", bad, 1)).rejects.toThrow();
        }
        expect(fs.readdirSync(root)).toEqual(["a.txt"]);
    });

    test("a drive at the top of a disk reaches the files on it", async () => {
        expect(within(`${path.sep}tmp`, path.sep)).toBe(true);
        expect(within("E:\\Photos", "E:\\")).toBe(path.sep === "\\");
        expect(within("/media/usb2", "/media/usb")).toBe(false);
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drive-top-")));
        try {
            fs.writeFileSync(path.join(dir, "photo.jpg"), "jpg");
            const top = path.parse(dir).root;
            const drive = new Drive(top);
            await drive.open();
            const rel = path.relative(top, path.join(dir, "photo.jpg")).split(path.sep).join("/");
            expect(await drive.stat(rel)).toMatchObject({ name: "photo.jpg", kind: "file", size: 3 });
            expect((await drive.list(path.relative(top, dir).split(path.sep).join("/"))).map((e) => e.name)).toEqual(["photo.jpg"]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("what can't be reached in a folder (a link round a loop, a folder it's not allowed in) doesn't stop it listing", async () => {
        const { drive, root, put } = await openDrive();
        put("notes.md", "x");
        fs.symlinkSync("Loop", path.join(root, "Loop"));
        fs.mkdirSync(path.join(root, "lost+found"), { mode: 0o000 });
        try {
            const listed = await drive.list("");
            expect(listed.map((e) => e.name).sort()).toEqual(["lost+found", "notes.md"]);
        } finally {
            // the drive's folder is removed after the test, which needs into this one again
            fs.chmodSync(path.join(root, "lost+found"), 0o755);
        }
    });

    test("the drive itself can't be renamed, moved or deleted", async () => {
        const { drive } = await openDrive();
        await expect(drive.rename("", "x")).rejects.toThrow("whole drive");
        await expect(drive.delete([""])).rejects.toThrow("whole drive");
        await expect(drive.move([""], "")).rejects.toThrow("whole drive");
    });
});
