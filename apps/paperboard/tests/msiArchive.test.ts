// Windows Installer packages as recipe archives (bun test): the cabinets an
// MSI carries are unpacked by papercrane/msiArchive.ts on any computer.
// The fixtures are checked against 7-Zip where it is installed, so the
// reader and the fixture builder can't agree on a format nobody else reads.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { extractMsi } from "../papercrane/msiArchive";
import { buildCompoundFile, buildMsi, type CabMember } from "./fixtures/msiFixture";

let root = "";
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "msi-archive-")); });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// 100 KB that reaches back across 32 KB block boundaries: a block that
// inflated without the one before it would come out wrong
const chunk = crypto.randomBytes(20_000);
const repeating = Buffer.concat([chunk, chunk, chunk, chunk, chunk]);
const MEMBERS: CabMember[] = [
    { name: "Microsoft_Xna_Framework_dll_GAC", data: repeating },
    { name: "EULA_File", data: Buffer.from("license text") },
    { name: "Empty_File", data: Buffer.alloc(0) },
];

function write(name: string, bytes: Buffer): string {
    const file = path.join(root, name);
    fs.writeFileSync(file, bytes);
    return file;
}

const sevenZip = Bun.which("7z");

describe("extractMsi", () => {
    it("unpacks every cabinet member by its File key, across MSZIP blocks", async () => {
        const dest = path.join(root, "out");
        await extractMsi(write("a.msi", buildMsi(MEMBERS)), dest);
        expect(fs.readdirSync(dest).sort()).toEqual(MEMBERS.map((m) => m.name).sort());
        for (const m of MEMBERS) expect(fs.readFileSync(path.join(dest, m.name)).equals(m.data)).toBe(true);
    });

    it.if(!!sevenZip)("reads the same bytes 7-Zip does", async () => {
        const msi = write("seven.msi", buildMsi(MEMBERS));
        const ours = path.join(root, "ours");
        await extractMsi(msi, ours);
        // 7-Zip reads the compound file and, separately, the cabinet inside it
        const streams = path.join(root, "streams");
        expect(Bun.spawnSync([sevenZip!, "x", "-y", `-o${streams}`, msi]).exitCode).toBe(0);
        const theirs = path.join(root, "theirs");
        expect(Bun.spawnSync([sevenZip!, "x", "-y", `-o${theirs}`, path.join(streams, "product.cab")]).exitCode).toBe(0);
        for (const m of MEMBERS) expect(fs.readFileSync(path.join(theirs, m.name)).equals(fs.readFileSync(path.join(ours, m.name)))).toBe(true);
    });

    it("unpacks a stored (uncompressed) cabinet", async () => {
        const dest = path.join(root, "stored");
        await extractMsi(write("stored.msi", buildMsi(MEMBERS, 0)), dest);
        expect(fs.readFileSync(path.join(dest, MEMBERS[0]!.name)).equals(repeating)).toBe(true);
    });

    it("refuses a compression it doesn't read (LZX) instead of guessing", async () => {
        await expect(extractMsi(write("lzx.msi", buildMsi(MEMBERS, 3)), path.join(root, "lzx"))).rejects.toThrow(/compression 3/);
    });

    it("refuses a member name that climbs out of the package", async () => {
        const dest = path.join(root, "climb", "inner");
        await expect(extractMsi(write("climb.msi", buildMsi([{ name: "..\\evil.dll", data: Buffer.from("x") }])), dest)).rejects.toThrow(/unsafe name/);
        expect(fs.existsSync(path.join(root, "climb", "evil.dll"))).toBe(false);
    });

    it("refuses a file that isn't an MSI, and an MSI without a cabinet", async () => {
        await expect(extractMsi(write("zip.msi", Buffer.from("PK\x03\x04 not a compound file".padEnd(600, " "))), path.join(root, "z"))).rejects.toThrow(/no compound file header/);
        const bare = buildCompoundFile([{ name: "StringPool", data: Buffer.from("tables only") }]);
        await expect(extractMsi(write("bare.msi", bare), path.join(root, "bare"))).rejects.toThrow(/carries no cabinet/);
    });

    it("refuses a truncated MSI", async () => {
        const whole = buildMsi(MEMBERS);
        await expect(extractMsi(write("cut.msi", whole.subarray(0, Math.floor(whole.length / 2))), path.join(root, "cut"))).rejects.toThrow();
    });
});
