// version-fabrication refusal (bun test): a manifest-less archive must NOT
// come home wearing a fabricated "1.0.0" or publisher "Paperboard"
import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import * as tar from "tar";
import crypto from "crypto";
import { PaperCraneEngine } from "../papercrane/engine";

let tmp = "";
let server: http.Server | null = null;

function serveTarball(archivePath: string): Promise<string> {
    return new Promise((resolve) => {
        server = http.createServer((_req, res) => {
            const data = fs.readFileSync(archivePath);
            res.writeHead(200, { "Content-Type": "application/gzip" });
            res.end(data);
        });
        server.listen(0, "127.0.0.1", () => {
            const addr = server!.address();
            resolve(`http://127.0.0.1:${(addr as any).port}/x.tar.gz`);
        });
    });
}

function makeArchive(src: string, dest: string): string {
    tar.create(
        { gzip: true, file: dest, cwd: src, sync: true },
        fs.readdirSync(src),
    );
    return crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
}

afterAll(() => {
    server?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("installPanel manifests for manifest-less archives", () => {
    it("installs with no fabricated version and no fabricated publisher", async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-manifest-"));
        const src = path.join(tmp, "src");
        fs.mkdirSync(path.join(src, "dist"), { recursive: true });
        fs.writeFileSync(
            path.join(src, "dist", "index.html"),
            "<html><body>no manifest</body></html>",
        );

        const archivePath = path.join(tmp, "panel.tar.gz");
        const sha = makeArchive(src, archivePath);
        const url = await serveTarball(archivePath);

        const engine = new PaperCraneEngine(tmp);
        const record = await engine.installPanel(
            "dev.test.nomanifest",
            url,
            sha,
        );

        expect(record.version).toBeUndefined();
        expect(record.publisher).toBeUndefined();
        expect(JSON.stringify(record)).not.toContain("1.0.0");
        expect(JSON.stringify(record)).not.toContain("Paperboard");
        expect(record.name).toBe("dev.test.nomanifest");
        expect(record.isInstalled).toBe(true);
    });
});