import { test, expect } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gameModeLabel, readWorldHeader, worldSizeLabel } from "../src/games/terraria/worldFile";
import { importUpload, inspectUpload, listWorlds, suggestedWorldName, trashWorld, UPLOAD_DIR } from "../src/games/terraria/worldStore";

/** A .wld in Terraria 1.4.5.8's layout (file version 326), with a few tile bytes after the header. */
type WorldOpts = { name: string; seed: string; width: number; height: number; gameMode: number; version?: number; fileType?: number; crimson?: boolean; hardmode?: boolean; defeated?: string[] };
function worldBytes(opts: WorldOpts): Uint8Array {
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
    worldFlags(opts, parts);
    parts.push(...new Array(64).fill(0));
    return Uint8Array.from(parts);
}

/** WorldFile.SaveWorldFlags for file version 326, with nonzero filler so a misaligned read shows. */
function worldFlags(opts: WorldOpts, parts: number[]) {
    const version = opts.version ?? 326;
    const bytes = (n: number, v = 3) => parts.push(...new Array(n).fill(v));
    const bool = (v = false) => parts.push(v ? 1 : 0);
    const int32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(...b); };
    const int16 = (v: number) => { const b = Buffer.alloc(2); b.writeInt16LE(v); parts.push(...b); };
    const boss = (name: string) => bool(opts.defeated?.includes(name));
    for (const added of [222, 227, 238, 239, 241, 249, 266, 267, 302]) if (version >= added) bool();
    bytes(8); if (version >= 284) bytes(8); // created, last played
    bytes(1 + 17 * 4 + 8 + 24); bool(true); bytes(4); bool(); bool(); bytes(8);
    bool(opts.crimson);
    for (const name of ["Eye of Cthulhu", "evil", "Skeletron", "Queen Bee", "The Destroyer", "The Twins", "Skeletron Prime", "any mech", "Plantera", "Golem", "King Slime"]) boss(name);
    for (let i = 0; i < 9; i++) bool();
    bytes(1 + 4); bool(opts.hardmode); if (version >= 257) bool();
    bytes(12 + 16 + 1); bool(); bytes(4 + 4 + 12); bytes(8 + 4); int16(3); bytes(4);
    int32(2); string(parts, "Angler fan"); string(parts, "Other");
    bool(); bytes(4); bool(); bool(); bool(); bytes(8);
    int16(2); bytes(8); if (version >= 289) { int16(3); bytes(6); }
    bool();
    for (const name of ["Duke Fishron", "Martian Saucer", "Lunatic Cultist", "Moon Lord", "Pumpking", "Mourning Wood", "Ice Queen", "Santa-NK1", "Everscream"]) boss(name);
    for (let i = 0; i < 9; i++) bool();
    bool(); bool(); bytes(4); int32(1); bytes(4);
    bool(); bytes(12);
    for (let i = 0; i < 4; i++) bool();
    bytes(5); bool(); bytes(4); bool(); bool(); bool();
    int32(2); bytes(8);
    bool(); bool(); bytes(16); bool(); bool(); bool();
    boss("Empress of Light"); boss("Queen Slime"); if (version >= 240) boss("Deerclops");
}
function string(parts: number[], s: string) {
    const bytes = Buffer.from(s, "utf8"); let n = bytes.length;
    while (n >= 0x80) { parts.push((n & 0x7f) | 0x80); n >>= 7; }
    parts.push(n); parts.push(...bytes);
}

test("a world's header reads its name, seed, size and difficulty", () => {
    const header = readWorldHeader(worldBytes({ name: "Gwen's Ünder World", seed: "pumpkinseason|345702611", width: 6400, height: 1800, gameMode: 1 }));
    expect(header).toEqual({ name: "Gwen's Ünder World", seed: "pumpkinseason|345702611", width: 6400, height: 1800, gameMode: 1, evil: "corruption", hardmode: false, bosses: [] });
    expect(worldSizeLabel(header.width)).toBe("Medium");
    expect(gameModeLabel(header.gameMode)).toBe("Expert");
    expect(worldSizeLabel(5000)).toBe("5000 wide");
});

test("a world's flags read its evil, hardmode and defeated bosses in progression order", () => {
    const header = readWorldHeader(worldBytes({ name: "Late", seed: "1", width: 4200, height: 1200, gameMode: 2, crimson: true, hardmode: true, defeated: ["Moon Lord", "evil", "King Slime", "Deerclops", "Queen Slime", "The Twins"] }));
    expect(header).toMatchObject({ evil: "crimson", hardmode: true, bosses: ["King Slime", "Brain of Cthulhu", "Deerclops", "Queen Slime", "The Twins", "Moon Lord"] });
    // the second boss is named for the world's evil
    expect(readWorldHeader(worldBytes({ name: "E", seed: "1", width: 4200, height: 1200, gameMode: 0, defeated: ["evil"] })).bosses).toEqual(["Eater of Worlds"]);
});

test("a 1.4.0 world, without the flags later releases added, reads too", () => {
    const header = readWorldHeader(worldBytes({ name: "Old", seed: "1", width: 4200, height: 1200, gameMode: 0, version: 230, hardmode: true, defeated: ["Golem"] }));
    expect(header).toMatchObject({ hardmode: true, bosses: ["Golem"] });
});

test("flags that are not bools are refused rather than shown", () => {
    const bytes = worldBytes({ name: "Bad", seed: "seedtail", width: 4200, height: 1200, gameMode: 0 });
    // past the seed: generator version, unique id, world id, bounds, height, width and game mode
    const flagsAt = Buffer.from(bytes).indexOf(Buffer.from("seedtail")) + 8 + 8 + 16 + 4 + 16 + 12;
    bytes.fill(2, flagsAt);
    expect(() => readWorldHeader(bytes)).toThrow("flags are damaged");
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
