import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { httpRequest } from "../papercrane/backups/http";
import { parseBackupRecord, type BackupRecord } from "../papercrane/backups/types";
import { S3BackupStore } from "../papercrane/backups/s3Store";
import { DriveBackupStore, forgetDriveToken } from "../papercrane/backups/driveStore";

const MAX = 5 * 1024 * 1024 * 1024;
const record: BackupRecord = { format: 1, id: "20261015-120000-abcdef", panelId: "dev.test.backups", createdAt: "2026-10-15T12:00:00Z", size: MAX + 1, sha256: "a".repeat(64), panelVersion: "0.2.0", label: null };
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
function destination() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-transfer-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, "archive");
}
async function serve(handler: http.RequestListener) {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test("remote metadata cannot raise the daemon archive budget", () => {
    expect(parseBackupRecord(record)).toBeNull();
    expect(parseBackupRecord({ ...record, size: MAX })).not.toBeNull();
});

test("both remote stores reject oversized download records before network use", async () => {
    let requests = 0;
    const base = await serve((_req, res) => { requests++; res.end("{}"); });
    const s3 = new S3BackupStore({ endpoint: base, region: "test", bucket: "test", prefix: "", accessKeyId: "test", pathStyle: true }, { secretAccessKey: "test" });
    const drive = new DriveBackupStore("limits-test", { clientId: "test", folderId: "test" }, { clientSecret: "test", refreshToken: "test" }, { tokenUrl: `${base}/token`, apiBase: base, uploadBase: base });
    cleanups.push(() => forgetDriveToken("limits-test"));
    for (const store of [s3, drive]) await expect(store.get(record, destination())).rejects.toThrow(/archive.*limit/i);
    expect(requests).toBe(0);
});

test("the transport caps advertised size independently of its caller", async () => {
    const base = await serve((_req, res) => { res.writeHead(200, { "Content-Length": String(MAX + 1) }); res.end(); });
    const dest = destination();
    await expect(httpRequest(base, { toFile: dest, maxFileBytes: Number.MAX_SAFE_INTEGER })).rejects.toThrow(/larger than/);
    expect(fs.existsSync(dest)).toBe(false);
});

test("chunked overflow cancels the transfer and removes partial bytes", async () => {
    const base = await serve((_req, res) => { res.writeHead(200); res.write("1234"); res.end("56789"); });
    const dest = destination();
    await expect(httpRequest(base, { toFile: dest, maxFileBytes: 8 })).rejects.toThrow(/larger than/);
    expect(fs.existsSync(dest)).toBe(false);
});

for (const headersFirst of [false, true]) test(`total deadline cancels a responsive peer (headers first: ${headersFirst})`, async () => {
    const base = await serve((_req, res) => {
        if (headersFirst) { res.writeHead(200); res.write("x"); }
        let ticks = 0;
        const timer = setInterval(() => {
            if (headersFirst) res.write("x");
            if (++ticks === 30) { clearInterval(timer); res.end(); }
        }, 10);
        res.once("close", () => clearInterval(timer));
    });
    const dest = destination();
    await expect(httpRequest(base, { toFile: dest, maxFileBytes: 100, timeoutMs: 1000, totalTimeoutMs: 60 })).rejects.toThrow(/deadline/);
    expect(fs.existsSync(dest)).toBe(false);
});
