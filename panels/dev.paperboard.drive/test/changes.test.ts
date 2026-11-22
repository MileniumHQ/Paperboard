// Listing, and the changes the page makes: folders, renames, moves, deletes.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { openDrive } from "./helpers/drive";

describe("the drive", () => {
    test("lists a folder's files and folders, with sizes, times and counts", async () => {
        const { drive, put } = await openDrive();
        put("Photos/a.jpg", "12345");
        put("Photos/b.jpg", "1");
        put("notes.md", "# Notes");
        const entries = (await drive.list("")).sort((a, b) => a.name.localeCompare(b.name));
        expect(entries.map(({ modified, ...rest }) => rest)).toEqual([
            { name: "notes.md", path: "notes.md", kind: "file", size: 7 },
            { name: "Photos", path: "Photos", kind: "folder", size: 0, count: 2 },
        ]);
        for (const e of entries) expect(e.modified).toBeGreaterThan(0);
        expect((await drive.list("Photos")).map((e) => e.path).sort()).toEqual(["Photos/a.jpg", "Photos/b.jpg"]);
        await expect(drive.list("notes.md")).rejects.toThrow("isn't a folder");
        await expect(drive.list("Nope")).rejects.toThrow("isn't in the drive");
    });

    test("makes folders, and won't make one over something already there", async () => {
        const { drive, root } = await openDrive();
        expect(await drive.createFolder("", "Taxes")).toMatchObject({ name: "Taxes", path: "Taxes", kind: "folder", count: 0 });
        expect((await drive.createFolder("Taxes", "2026")).path).toBe("Taxes/2026");
        await expect(drive.createFolder("", "Taxes")).rejects.toThrow("already something called “Taxes”");
        expect(fs.statSync(path.join(root, "Taxes/2026")).isDirectory()).toBe(true);
    });

    test("renames in place, refuses a name that's taken, and allows a change of case", async () => {
        const { drive, root, put } = await openDrive();
        put("Docs/draft.md", "draft");
        put("Docs/final.md", "final");
        expect((await drive.rename("Docs/draft.md", "Novel.md")).path).toBe("Docs/Novel.md");
        await expect(drive.rename("Docs/Novel.md", "final.md")).rejects.toThrow("already something called “final.md”");
        expect((await drive.rename("Docs/Novel.md", "novel.md")).path).toBe("Docs/novel.md");
        expect(fs.readdirSync(path.join(root, "Docs")).sort()).toEqual(["final.md", "novel.md"]);
        expect(fs.readFileSync(path.join(root, "Docs/final.md"), "utf8")).toBe("final");
        expect((await drive.rename("Docs", "Writing")).path).toBe("Writing");
        expect((await drive.list("Writing")).length).toBe(2);
    });

    test("a change of case never replaces a different file whose name differs only in case", async () => {
        const { drive, root, put } = await openDrive();
        put("notes.txt", "lower");
        put("Notes.txt", "UPPER");
        await expect(drive.rename("notes.txt", "Notes.txt")).rejects.toThrow("already something called “Notes.txt”");
        expect(fs.readFileSync(path.join(root, "notes.txt"), "utf8")).toBe("lower");
        expect(fs.readFileSync(path.join(root, "Notes.txt"), "utf8")).toBe("UPPER");
    });

    test("a broken link holds its name: nothing is renamed or moved over it", async () => {
        const { drive, root, put } = await openDrive();
        put("a.txt", "a");
        put("Box/keep.txt", "keep");
        fs.symlinkSync(path.join(root, "gone"), path.join(root, "b.txt"));
        fs.symlinkSync(path.join(root, "gone"), path.join(root, "Box/a.txt"));
        await expect(drive.rename("a.txt", "b.txt")).rejects.toThrow("already something called “b.txt”");
        await expect(drive.move(["a.txt"], "Box")).rejects.toThrow("already something called “a.txt”");
        expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("a");
        expect(fs.lstatSync(path.join(root, "b.txt")).isSymbolicLink()).toBe(true);
    });

    test("moves into folders, but never into itself, onto a name there, or where it already is", async () => {
        const { drive, root, put } = await openDrive();
        put("a.txt", "a");
        put("b.txt", "b");
        put("Box/b.txt", "other b");
        put("Box/Inner/c.txt", "c");
        expect((await drive.move(["a.txt"], "Box/Inner")).map((e) => e.path)).toEqual(["Box/Inner/a.txt"]);
        await expect(drive.move(["Box"], "Box/Inner")).rejects.toThrow("can't go inside itself");
        await expect(drive.move(["Box"], "Box")).rejects.toThrow("can't go inside itself");
        await expect(drive.move(["b.txt"], "Box")).rejects.toThrow("already something called “b.txt” there");
        await expect(drive.move(["b.txt"], "")).rejects.toThrow("already there");
        // a refused move moves nothing, even the ones that could have
        put("d.txt", "d");
        await expect(drive.move(["d.txt", "b.txt"], "Box")).rejects.toThrow("b.txt");
        expect(fs.existsSync(path.join(root, "d.txt"))).toBe(true);
        expect((await drive.move(["Box/Inner"], "")).map((e) => e.path)).toEqual(["Inner"]);
        expect((await drive.list("Inner")).map((e) => e.name).sort()).toEqual(["a.txt", "c.txt"]);
    });

    test("deletes files and whole folders for good", async () => {
        const { drive, root, put } = await openDrive();
        put("Old/deep/x.txt", "x");
        put("y.txt", "y");
        put("keep.txt", "k");
        await drive.delete(["Old", "y.txt"]);
        expect(fs.readdirSync(root)).toEqual(["keep.txt"]);
        await expect(drive.delete(["y.txt"])).rejects.toThrow("isn't in the drive");
        await expect(drive.delete([])).rejects.toThrow("Nothing to delete");
    });

    test("writes text over a file, making its folders, and reads it back", async () => {
        const { drive, root } = await openDrive();
        expect((await drive.writeText("Notes/2026/today.md", "# Today")).path).toBe("Notes/2026/today.md");
        expect(await drive.readText("Notes/2026/today.md")).toBe("# Today");
        await drive.writeText("Notes/2026/today.md", "replaced");
        expect(fs.readFileSync(path.join(root, "Notes/2026/today.md"), "utf8")).toBe("replaced");
        await expect(drive.writeText("Notes", "x")).rejects.toThrow("is a folder");
        await expect(drive.writeText("", "x")).rejects.toThrow("needs a name");
    });

    test("reads only text as text", async () => {
        const { drive, put } = await openDrive();
        put("photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
        put("bad.txt", Buffer.from([0xff, 0xfe, 0x41]));
        await expect(drive.readText("photo.png")).rejects.toThrow("isn't a text file");
        await expect(drive.readText("bad.txt")).rejects.toThrow("isn't a text file");
        await drive.createFolder("", "Folder");
        await expect(drive.readText("Folder")).rejects.toThrow("isn't a file");
    });
});
