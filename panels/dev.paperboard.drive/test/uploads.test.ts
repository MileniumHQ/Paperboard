// Uploads arrive in pieces into a hidden part in the folder they go to, land
// under their name only once whole, and leave nothing behind when they stop.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CHUNK_BYTES } from "../src/lib/contract";
import { Drive, numberedName, PART_PREFIX, UPLOAD_IDLE_MS } from "../src/lib/drive";
import { openDrive } from "./helpers/drive";

async function send(drive: Drive, folder: string, name: string, data: Buffer) {
    const { id } = await drive.uploadBegin(folder, name, data.length);
    for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) await drive.uploadPut(id, offset, data.subarray(offset, offset + CHUNK_BYTES));
    return drive.uploadFinish(id);
}

describe("uploads", () => {
    test("a file sent in pieces lands whole, and only once it's whole", async () => {
        const { drive, root, parts } = await openDrive();
        const data = randomBytes(CHUNK_BYTES * 2 + 123);
        const { id } = await drive.uploadBegin("", "film.mp4", data.length);
        await drive.uploadPut(id, 0, data.subarray(0, CHUNK_BYTES));
        // half-sent, it's not in the drive
        expect(await drive.list("")).toEqual([]);
        expect(parts()).toHaveLength(1);
        await drive.uploadPut(id, CHUNK_BYTES, data.subarray(CHUNK_BYTES, CHUNK_BYTES * 2));
        await drive.uploadPut(id, CHUNK_BYTES * 2, data.subarray(CHUNK_BYTES * 2));
        const entry = await drive.uploadFinish(id);
        expect(entry).toMatchObject({ name: "film.mp4", path: "film.mp4", kind: "file", size: data.length });
        expect(fs.readFileSync(path.join(root, "film.mp4")).equals(data)).toBe(true);
        expect(parts()).toEqual([]);
        expect(drive.uploading()).toBe(0);
    });

    test("an empty file uploads", async () => {
        const { drive, root } = await openDrive();
        const { id } = await drive.uploadBegin("", "empty.txt", 0);
        expect(await drive.uploadFinish(id)).toMatchObject({ name: "empty.txt", size: 0 });
        expect(fs.readFileSync(path.join(root, "empty.txt")).length).toBe(0);
    });

    test("a name already taken gets the next free number, files and folders alike", async () => {
        const { drive, put } = await openDrive();
        put("Photos/beach.jpg", "old");
        put("Photos/beach 2.jpg", "old");
        expect((await send(drive, "Photos", "beach.jpg", Buffer.from("new"))).path).toBe("Photos/beach 3.jpg");
        expect((await send(drive, "Photos", "beach.jpg", Buffer.from("newer"))).path).toBe("Photos/beach 4.jpg");
        await drive.createFolder("", "Notes");
        expect((await send(drive, "", "Notes", Buffer.from("x"))).path).toBe("Notes 2");
        expect(numberedName(".env", 2)).toBe(".env 2");
        expect(numberedName("archive.tar.gz", 2)).toBe("archive.tar 2.gz");
    });

    test("two uploads of one name finishing together never land on each other", async () => {
        const { drive, root } = await openDrive();
        const a = await drive.uploadBegin("", "same.txt", 1);
        const b = await drive.uploadBegin("", "same.txt", 1);
        await Promise.all([drive.uploadPut(a.id, 0, Buffer.from("a")), drive.uploadPut(b.id, 0, Buffer.from("b"))]);
        const landed = await Promise.all([drive.uploadFinish(a.id), drive.uploadFinish(b.id)]);
        expect(landed.map((e) => e.name).sort()).toEqual(["same 2.txt", "same.txt"]);
        expect(fs.readdirSync(root).map((n) => fs.readFileSync(path.join(root, n), "utf8")).sort()).toEqual(["a", "b"]);
    });

    test("canceling removes what was written, and the upload is gone", async () => {
        const { drive, parts } = await openDrive();
        const { id } = await drive.uploadBegin("", "big.bin", CHUNK_BYTES * 3);
        await drive.uploadPut(id, 0, randomBytes(CHUNK_BYTES));
        expect(parts()).toHaveLength(1);
        await drive.uploadCancel(id);
        expect(parts()).toEqual([]);
        expect(await drive.list("")).toEqual([]);
        await expect(drive.uploadPut(id, CHUNK_BYTES, randomBytes(10))).rejects.toThrow("isn't under way");
        await expect(drive.uploadFinish(id)).rejects.toThrow("isn't under way");
    });

    test("pieces out of order, oversized or past the end are refused, and a short file doesn't finish", async () => {
        const { drive } = await openDrive();
        const { id } = await drive.uploadBegin("", "a.bin", 10);
        await expect(drive.uploadPut(id, 5, Buffer.alloc(5))).rejects.toThrow("Expected the piece at 0");
        await expect(drive.uploadPut(id, 0, Buffer.alloc(11))).rejects.toThrow("more than the file's size");
        await expect(drive.uploadPut(id, 0, Buffer.alloc(0))).rejects.toThrow("A piece is");
        await drive.uploadPut(id, 0, Buffer.alloc(4));
        await expect(drive.uploadFinish(id)).rejects.toThrow("has 4 of its 10 bytes");
        expect(await drive.list("")).toEqual([]);
        await expect(drive.uploadBegin("", "b.bin", -1)).rejects.toThrow("not a file's size");
        await expect(drive.uploadBegin("", "b.bin", 1.5)).rejects.toThrow("not a file's size");
        await expect(drive.uploadBegin("", "b.bin", Number.MAX_SAFE_INTEGER)).rejects.toThrow("There isn't room");
    });

    test("a big file goes to disk piece by piece, and comes back the same way", async () => {
        const { drive, root, parts } = await openDrive();
        const pieces = 24; // 96 MB
        const { id } = await drive.uploadBegin("", "big.bin", pieces * CHUNK_BYTES);
        const piece = Buffer.alloc(CHUNK_BYTES);
        for (let i = 0; i < pieces; i++) {
            piece.fill(i);
            await drive.uploadPut(id, i * CHUNK_BYTES, piece);
            // each piece is on disk as soon as it's taken: nothing waits in memory for the rest
            const [part] = parts();
            expect(fs.statSync(path.join(root, part)).size).toBe((i + 1) * CHUNK_BYTES);
        }
        const entry = await drive.uploadFinish(id);
        expect(entry.size).toBe(pieces * CHUNK_BYTES);
        expect(fs.statSync(path.join(root, "big.bin")).size).toBe(pieces * CHUNK_BYTES);

        // read back one piece at a time, never more than a piece per call
        for (const i of [0, 7, pieces - 1]) {
            const back = await drive.read("big.bin", i * CHUNK_BYTES);
            expect(back.size).toBe(pieces * CHUNK_BYTES);
            expect(back.data.length).toBe(CHUNK_BYTES);
            expect(back.data[0]).toBe(i);
            expect(back.data[CHUNK_BYTES - 1]).toBe(i);
        }
        expect((await drive.read("big.bin", pieces * CHUNK_BYTES)).data.length).toBe(0);
        await expect(drive.read("big.bin", pieces * CHUNK_BYTES + 1)).rejects.toThrow("not a place in the file");
    });

    test("an upload into a folder that went away fails, and leaves nothing", async () => {
        const { drive, root } = await openDrive();
        await drive.createFolder("", "Gone");
        const { id } = await drive.uploadBegin("Gone", "a.txt", 1);
        await drive.uploadPut(id, 0, Buffer.from("a"));
        await drive.delete(["Gone"]);
        await expect(drive.uploadFinish(id)).rejects.toThrow("isn't in the drive");
        expect(fs.readdirSync(root)).toEqual([]);
    });

    test("a part waits hidden in the folder it goes to, and lands there whole", async () => {
        const { outside } = await openDrive();
        fs.mkdirSync(path.join(outside, "Photos"));
        const linked = new Drive(outside);
        await linked.open();
        const data = randomBytes(CHUNK_BYTES + 10);
        const { id } = await linked.uploadBegin("Photos", "beach.jpg", data.length);
        await linked.uploadPut(id, 0, data.subarray(0, CHUNK_BYTES));
        // the part is on the same disk as where it goes, so landing is a rename, and no list shows it
        const parts = fs.readdirSync(path.join(outside, "Photos"));
        expect(parts).toHaveLength(1);
        expect(parts[0].startsWith(PART_PREFIX)).toBe(true);
        expect(await linked.list("Photos")).toEqual([]);
        await linked.uploadPut(id, CHUNK_BYTES, data.subarray(CHUNK_BYTES));
        expect((await linked.uploadFinish(id)).path).toBe("Photos/beach.jpg");
        expect(fs.readdirSync(path.join(outside, "Photos"))).toEqual(["beach.jpg"]);
        expect(fs.readFileSync(path.join(outside, "Photos/beach.jpg")).equals(data)).toBe(true);
        await linked.close();
    });

    test("a part a stop left goes with a list once it has sat a while, and a live one stays", async () => {
        const { outside } = await openDrive();
        const linked = new Drive(outside);
        await linked.open();
        const stale = path.join(outside, `${PART_PREFIX}old.part`);
        fs.writeFileSync(stale, "half");
        const old = (Date.now() - UPLOAD_IDLE_MS - 1000) / 1000;
        fs.utimesSync(stale, old, old);
        const fresh = path.join(outside, `${PART_PREFIX}new.part`);
        fs.writeFileSync(fresh, "half");
        const { id } = await linked.uploadBegin("", "live.bin", 10);
        await linked.uploadPut(id, 0, Buffer.alloc(5));
        expect(await linked.list("")).toEqual([]);
        // a part someone else may still be writing (another window's upload) is left alone until it's old
        expect(fs.existsSync(stale)).toBe(false);
        expect(fs.existsSync(fresh)).toBe(true);
        await linked.uploadCancel(id);
        expect(fs.readdirSync(outside).sort()).toEqual([`${PART_PREFIX}new.part`]);
        await linked.close();
    });

    test("a folder that isn't there won't open as a drive, and is never made", async () => {
        const { outside } = await openDrive();
        const gone = path.join(outside, "Gone");
        await expect(new Drive(gone).open()).rejects.toThrow("isn't there");
        expect(fs.existsSync(gone)).toBe(false);
        fs.writeFileSync(gone, "a file");
        await expect(new Drive(gone).open()).rejects.toThrow("isn't a folder");
    });
});
