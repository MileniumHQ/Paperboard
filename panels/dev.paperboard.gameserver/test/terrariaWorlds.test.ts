import { test, expect } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gameModeLabel, readWorldHeader, worldSizeLabel } from "../src/games/terraria/worldFile";
import { importUpload, inspectUpload, listWorlds, suggestedWorldName, trashWorld, UPLOAD_DIR } from "../src/games/terraria/worldStore";

/** A .wld in Terraria 1.4.5.8's layout (file version 326), with a few tile bytes after the header. */
function worldBytes(opts: { name: string; seed: string; width: number; height: number; gameMode: number; version?: number; fileType?: number }): Uint8Array {
    const parts: number[] = [];
    const int32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(...b); };
    const int16 = (v: number) => { const b = Buffer.alloc(2); b.writeInt16LE(v); parts.push(...b); };
    const uint64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); parts.push(...b); };
    const string = (s: string) => { const bytes = Buffer.from(s, "utf8"); let n = bytes.length; while (n >= 0x80) { parts.push((n & 0x7f) | 0x80); n >>= 7; } parts.push(n); parts.push(...bytes); };
    int32(opts.version ?? 326);
    uint64(0x6369676f6c6572n | (BigInt(opts.fileType ?? 2) << 56n));
    int32(2); // revision
    uint64(0n); // favorite
    const sections = 11;
    int16(sections);
    const tableAt = parts.length;
    for (let i = 0; i < sections; i++) int32(0);
    int16(12); parts.push(0, 0); // tile-frame-important bits
    const headerAt = parts.length;
    Buffer.from(Uint32Array.of(headerAt).buffer).forEach((b, i) => { parts[tableAt + i] = b; });
    string(opts.name);
    string(opts.seed);
    uint64(1n); // generator version
    parts.push(...new Array(16).fill(7)); // unique id
    int32(123); // world id
    int32(0); int32(opts.width * 16); int32(0); int32(opts.height * 16); // bounds
    int32(opts.height);
    int32(opts.width);
    int32(opts.gameMode);
    parts.push(...new Array(64).fill(0));
    return Uint8Array.from(parts);
}

test("a world's header reads its name, seed, size and difficulty", () => {
    const header = readWorldHeader(worldBytes({ name: "Gwen's Ünder World", seed: "pumpkinseason|345702611", width: 6400, height: 1800, gameMode: 1 }));
    expect(header).toEqual({ name: "Gwen's Ünder World", seed: "pumpkinseason|345702611", width: 6400, height: 1800, gameMode: 1 });
    expect(worldSizeLabel(header.width)).toBe("Medium");
    expect(gameModeLabel(header.gameMode)).toBe("Expert");
    expect(worldSizeLabel(5000)).toBe("5000 wide");
});

test("anything but a 1.4 world is refused with a reason", () => {
    expect(() => readWorldHeader(new TextEncoder().encode("not a world at all, just some text"))).toThrow("not a Terraria world");
    expect(() => readWorldHeader(worldBytes({ name: "P", seed: "1", width: 4200, height: 1200, gameMode: 0, fileType: 3 }))).toThrow("not a Terraria world");
    expect(() => readWorldHeader(worldBytes({ name: "Old", seed: "1", width: 4200, height: 1200, gameMode: 0, version: 194 }))).toThrow("old Terraria release");
    expect(() => readWorldHeader(worldBytes({ name: "W", seed: "1", width: 4200, height: 1200, gameMode: 0 }).subarray(0, 60))).toThrow("ends early");
});

test("the worlds folder lists each world, marks the active one and lists a new active world before it exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "terraria-worlds-"));
    try {
        const dir = path.join(root, "worlds");
        await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, "Alpha.wld"), worldBytes({ name: "Alpha", seed: "1", width: 8400, height: 2400, gameMode: 3 }));
        await fs.writeFile(path.join(dir, "Broken.wld"), "nope");
        const worlds = await listWorlds(dir, "Alpha");
        expect(worlds.map((w) => [w.name, w.active, w.generated, w.header?.width ?? null])).toEqual([["Alpha", true, true, 8400], ["Broken", false, true, null]]);
        expect(worlds[1].error).toContain("not a Terraria world");
        const pending = await listWorlds(dir, "Fresh");
        expect(pending[0]).toMatchObject({ name: "Fresh", active: true, generated: false, header: null });
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("an uploaded world is checked, named and added without replacing one; a non-world is removed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "terraria-upload-"));
    try {
        await fs.mkdir(path.join(root, "worlds"));
        await fs.mkdir(path.join(root, UPLOAD_DIR));
        await fs.writeFile(path.join(root, "worlds", "Home.wld"), worldBytes({ name: "Home", seed: "1", width: 4200, height: 1200, gameMode: 0 }));
        const file = `upload-${crypto.randomUUID()}.wld`;
        await fs.writeFile(path.join(root, UPLOAD_DIR, file), worldBytes({ name: "Home!", seed: "9", width: 6400, height: 1800, gameMode: 2 }));
        const inspected = await inspectUpload(root, file);
        expect(inspected.suggestedName).toBe("Home 2");
        await expect(importUpload(root, file, "Home")).rejects.toThrow("already exists");
        // a refused import removes the upload too
        expect(await fs.readdir(path.join(root, UPLOAD_DIR))).toEqual([]);

        await fs.writeFile(path.join(root, UPLOAD_DIR, file), worldBytes({ name: "Home!", seed: "9", width: 6400, height: 1800, gameMode: 2 }));
        await importUpload(root, file, "Home 2");
        expect((await listWorlds(path.join(root, "worlds"), "Home")).map((w) => w.name)).toEqual(["Home", "Home 2"]);

        const junk = `upload-${crypto.randomUUID()}.wld`;
        await fs.writeFile(path.join(root, UPLOAD_DIR, junk), "PK zip, not a world");
        await expect(inspectUpload(root, junk)).rejects.toThrow("not a Terraria world");
        expect(await fs.readdir(path.join(root, UPLOAD_DIR))).toEqual([]);
        await expect(inspectUpload(root, "../worlds/Home.wld")).rejects.toThrow("Choose a world");
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("deleting a world moves it and its backups to the trash, never deletes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "terraria-trash-"));
    try {
        await fs.mkdir(path.join(root, "worlds"));
        await fs.writeFile(path.join(root, "worlds", "Mündo.wld"), "world");
        await fs.writeFile(path.join(root, "worlds", "Mündo.wld.bak"), "backup");
        await fs.writeFile(path.join(root, "worlds", "Mündo.wld.bak2"), "older backup");
        await fs.writeFile(path.join(root, "worlds", "Mündo 2.wld"), "another world");
        await trashWorld(root, "Mündo", 42);
        expect((await fs.readdir(path.join(root, ".trash-42", "worlds"))).sort()).toEqual(["Mündo.wld", "Mündo.wld.bak", "Mündo.wld.bak2"]);
        expect(await fs.readdir(path.join(root, "worlds"))).toEqual(["Mündo 2.wld"]);
        await expect(trashWorld(root, "Mündo")).rejects.toThrow("no world named");
        await expect(trashWorld(root, "../etc")).rejects.toThrow("World name");
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("an uploaded world's own name becomes a file name", () => {
    expect(suggestedWorldName("Bob's World", [])).toBe("Bobs World");
    expect(suggestedWorldName("???", ["World"])).toBe("World 2");
});
