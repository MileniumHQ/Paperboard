// What Drive does with the system it runs on: a disk's top ("/", "E:\"), the
// computer's top in the folder picker, what can't be reached in a folder, and
// the disks plugged in. CI runs these on every release target.
import { describe, expect, onTestFinished, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPUTER } from "../../src/lib/contract";
import { DiskReader, windowsLetters } from "../../src/lib/disks";
import { Drive, within } from "../../src/lib/drive";
import { Places } from "../../src/lib/places";
import { openDrive } from "../helpers/drive";

const windows = process.platform === "win32";

function tempDir(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drive-system-")));
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

describe("Drive on this system", () => {
    test("a drive at the top of a disk reaches the files on it", async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, "photo.jpg"), "jpg");
        const top = path.parse(dir).root;
        expect(within(dir, top)).toBe(true);
        expect(within(`${dir}2`, dir)).toBe(false);
        const drive = new Drive(top);
        await drive.open();
        const folder = path.relative(top, dir).split(path.sep).join("/");
        expect(await drive.stat(`${folder}/photo.jpg`)).toMatchObject({ name: "photo.jpg", kind: "file", size: 3 });
        expect((await drive.list(folder)).map((e) => e.name)).toEqual(["photo.jpg"]);
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

    test("the folder picker climbs to the computer's top: each drive letter on Windows, / anywhere else", async () => {
        const dir = tempDir();
        const places = new Places({
            root: path.join(dir, "data/Drive"),
            saved: path.join(dir, "data/places.json"),
            disks: { read: async () => [] },
            onChange: () => {},
            onUnplugged: () => {},
            onProblem: () => {},
        });
        await places.open();
        onTestFinished(() => places.close());
        const top = path.parse(dir).root;
        expect((await places.browse(top)).parent).toBe(windows ? COMPUTER : null);
        const computer = await places.browse(COMPUTER);
        expect(computer).toMatchObject({ path: COMPUTER, parent: null });
        expect(computer.cannotLink).toBeDefined();
        expect(computer.folders.map((f) => f.path)).toContain(top);
    });

    test("the disks plugged in are read without failing, each at a folder that's there", async () => {
        const disks = await new DiskReader().read();
        for (const disk of disks) {
            expect(path.isAbsolute(disk.mount)).toBe(true);
            expect(fs.statSync(disk.mount).isDirectory()).toBe(true);
            expect(disk.name).not.toBe("");
        }
        if (windows) {
            const system = (process.env.SystemDrive ?? "C:").slice(0, 1).toUpperCase();
            expect((await windowsLetters()).map((l) => l.letter)).toContain(system);
            expect(disks.map((d) => d.mount)).not.toContain(`${system}:\\`);
        }
    });
});
