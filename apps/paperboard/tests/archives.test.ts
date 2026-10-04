import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as tar from "tar";
import AdmZip from "adm-zip";
import { extractArchive, extractPackageArchive } from "../papercrane/engineArchives";
import { gzipSync } from "zlib";

let tmp = "";

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archives-test-"));
});

afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("extractArchive", () => {
    it("extracts tar.gz archives", async () => {
        const src = path.join(tmp, "tarsrc");
        fs.mkdirSync(path.join(src, "pkg", "bin"), { recursive: true });
        fs.writeFileSync(path.join(src, "pkg", "bin", "tool"), "x");
        const archive = path.join(tmp, "a.tar.gz");
        await tar.create({ gzip: true, file: archive, cwd: src }, ["pkg"]);
        const dest = path.join(tmp, "tarout");
        await extractArchive(archive, dest);
        expect(fs.existsSync(path.join(dest, "pkg", "bin", "tool"))).toBe(true);
    });

    it("extracts zip archives without system tools", async () => {
        const zip = new AdmZip();
        zip.addFile("wrapper/bin/tool.exe", Buffer.from("x"));
        const archive = path.join(tmp, "b.zip");
        zip.writeZip(archive);
        const dest = path.join(tmp, "zipout");
        await extractArchive(archive, dest);
        expect(fs.existsSync(path.join(dest, "wrapper", "bin", "tool.exe"))).toBe(true);
    });

    it("rejects zip-slip entries", async () => {
        // plant traversal via byte swap so offsets stay valid
        const zip = new AdmZip();
        zip.addFile("sub/evil.txt", Buffer.from("x"));
        const raw = Buffer.from(
            zip.toBuffer().toString("binary").split("sub/evil.txt").join("../evil.txt"),
            "binary",
        );
        const archive = path.join(tmp, "evil.zip");
        fs.writeFileSync(archive, raw);
        const dest = path.join(tmp, "evilout");
        let threw = false;
        try {
            await extractArchive(archive, dest);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
        expect(fs.existsSync(path.join(tmp, "evil.txt"))).toBe(false);
    });
});

describe("tar traversal is a refusal, not a skip", () => {
    // node-tar refuses to CREATE traversal archives, so the fixture is
    // written by hand: one ustar header block with an escaping name and a
    // correct checksum, followed by the entry's data block
    function ustarMember(name: string, content: Buffer): Buffer {
        const blocks = Buffer.concat([
            Buffer.alloc(512),
            Buffer.alloc(Math.ceil(content.length / 512) * 512),
        ]);
        const header = blocks.subarray(0, 512);
        header.write(name, 0, 100);
        header.write("0000644\0", 100); // mode
        header.write("0000000\0", 108); // uid
        header.write("0000000\0", 116); // gid
        header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124); // size
        header.write("00000000000\0", 136); // mtime
        header.write("0\0\0\0\0\0\0\0", 148); // checksum placeholder
        header.write("ustar\0", 257);
        header.write("00", 263); // version
        let sum = 0;
        for (let i = 0; i < 512; i++) {
            // checksum is the whole header summed as bytes, with only the
            // checksum field itself blank
            sum += i >= 148 && i < 156 ? 32 : header.readUInt8(i);
        }
        header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
        content.copy(blocks, 512);
        return blocks;
    }

    // node-tar's extract requires records to be a multiple of 10240, so
    // the padded trailing region doubles as the end-of-archive zero blocks
    function writeTar(name: string, entryName: string): string {
        const blocks = ustarMember(entryName, Buffer.from("x"));
        const padded = Buffer.alloc(Math.ceil((blocks.length + 1024) / 10240) * 10240);
        blocks.copy(padded);
        const archive = path.join(tmp, `${name}-evil.tar.gz`);
        fs.writeFileSync(archive, gzipSync(padded));
        return archive;
    }

    it("refuses a flat archive with a traversal member", async () => {
        const archive = writeTar("plain", "../plain-escaped.txt");
        const dest = path.join(tmp, "plain-out");
        await expect(extractArchive(archive, dest)).rejects.toThrow(/escapes destination/);
        expect(fs.existsSync(path.join(tmp, "plain-escaped.txt"))).toBe(false);
    });

    it("refuses, not retries flat, when a wrapped-layout extraction escapes", async () => {
        const archive = writeTar("wrapped", "../wrapped-escaped.txt");
        // extractPackageArchive with layout wrapped strips one level; the
        // entry falling outside the destination must fail the install
        // outright, never get a second extraction under a fresh budget
        await expect(extractPackageArchive(archive, path.join(tmp, "wrapped-out"), "wrapped", ".tar.gz"))
            .rejects.toThrow(/escapes destination/);
    });

    it("still re-extracts a wrapper-less archive flat", async () => {
        // no top-level wrapper means the strip-1 pass leaves no bin/, and
        // the flat fallback that serves that shape must keep working
        const archive = writeTar("wrapperless", "bin/tools/launch");
        const pkgDir = path.join(tmp, "wrapperless-out");
        await extractPackageArchive(archive, pkgDir, "wrapped", ".tar.gz");
        expect(fs.existsSync(path.join(pkgDir, "bin", "tools", "launch"))).toBe(true);
    });
});
