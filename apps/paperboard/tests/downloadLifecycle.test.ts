import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { streamToFileWithProgress } from "../papercrane/storage";
import { PaperCraneEngine } from "../papercrane/engine";

test("download pipeline verifies bytes and removes partial data on stream failure or cap refusal", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "download-pipeline-"));
    const bytes = Buffer.alloc(512 * 1024, "x");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(bytes) });
    try {
        const target = path.join(root, "file");
        const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
        await streamToFileWithProgress(`http://127.0.0.1:${server.port}/`, target, undefined, undefined, sha);
        expect(fs.readFileSync(target).equals(bytes)).toBe(true);
        await expect(streamToFileWithProgress(`http://127.0.0.1:${server.port}/`, target, undefined, undefined, undefined, { maxBytes: 1024 })).rejects.toThrow(/cap/);
        expect(fs.existsSync(target)).toBe(false);
        await expect(streamToFileWithProgress(`http://127.0.0.1:${server.port}/`, target, () => { throw new Error("destination consumer failed"); })).rejects.toThrow("destination consumer failed");
        expect(fs.existsSync(target)).toBe(false);
        // A subsequent download proves the failed operation released its slot.
        await streamToFileWithProgress(`http://127.0.0.1:${server.port}/`, target);
        expect(fs.statSync(target).size).toBe(bytes.length);
    } finally { await server.stop(true); fs.rmSync(root, { recursive: true, force: true }); }
});

test("downloads fetch only http(s): a file:// URL never copies a local file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "download-scheme-"));
    try {
        const secret = path.join(root, "secrets.json");
        fs.writeFileSync(secret, '{"panel.a/token":{"value":"hunter2"}}');
        const engine = new PaperCraneEngine(path.join(root, "home"));
        for (const url of [`file://${secret}`, "data:text/plain,hello", "ftp://example.com/x"]) {
            await expect(engine.downloadFile(url, "copy.json", "panel.b", "d1")).rejects.toThrow(/Download refused/);
        }
        expect(fs.existsSync(engine.resolveSecureTargetPath("copy.json", "panel.b"))).toBe(false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
