import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as tar from "tar";
import AdmZip from "adm-zip";
import { extractArchive } from "../papercrane/engineArchives";

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
