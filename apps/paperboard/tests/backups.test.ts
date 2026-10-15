import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import * as tar from "tar";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { PanelServicesManager } from "../papercrane/panelServices";
import { panelFilesDirName } from "../papercrane/storage";
import { handleBackups } from "../papercrane/rpc/backups";
import { extractPanelArchive } from "../papercrane/backups/archive";
import { S3BackupStore, signS3Request } from "../papercrane/backups/s3Store";
import { DriveBackupStore } from "../papercrane/backups/driveStore";
import { isNewerVersion } from "../papercrane/backups/service";
import { newBackupId, type BackupRecord } from "../papercrane/backups/types";
import { createPanelArchive } from "../papercrane/backups/archive";

const ID = "dev.test.backups";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
});

function tmp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// an installed panel whose service refuses to become ready when its stored
// mode is "broken", and records each generation's view of its data
function panelFixture(version = "0.2.0") {
    const root = tmp("paperboard-backups-");
    const dir = path.join(root, "panels", ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: ID, name: "Backups", version, service: "service.mjs" }));
    const filesDir = path.join(root, "files", panelFilesDirName(ID));
    fs.writeFileSync(
        path.join(dir, "service.mjs"),
        `import fs from 'node:fs';
const mode = fs.readFileSync(${JSON.stringify(path.join(filesDir, "mode.txt"))}, 'utf8');
if (mode === 'broken') process.exit(3);
fs.appendFileSync('seen', mode + '\\n');
process.send({ type: 'paperboard:service-ready', panelId: ${JSON.stringify(ID)} });
setInterval(() => {}, 1000);`,
    );
    fs.mkdirSync(filesDir, { recursive: true });
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const services = new PanelServicesManager(root);
    services.setAuth(auth);
    const engine = new PaperCraneEngine(root, services);
    cleanups.push(async () => {
        await services.stopService(ID);
        auth.dispose();
    });
    const call = async (action: string, params: any, claim: string | null = null) => {
        let answer: { result: any; error?: string; code?: string } | undefined;
        const ctx = { engine, callerPanelId: () => claim, reply: (_id: unknown, result: any, error?: string, code?: string) => (answer = { result, error, code }) };
        expect(await handleBackups(action, 1, params, ctx as any)).toBe(true);
        return answer!;
    };
    const writeData = (mode: string, config: object) => {
        fs.writeFileSync(path.join(filesDir, "mode.txt"), mode);
        fs.mkdirSync(path.join(root, "configs"), { recursive: true });
        fs.writeFileSync(path.join(root, "configs", `${ID}.json`), JSON.stringify(config));
    };
    const readData = () => ({
        mode: fs.readFileSync(path.join(filesDir, "mode.txt"), "utf8"),
        config: JSON.parse(fs.readFileSync(path.join(root, "configs", `${ID}.json`), "utf8")),
    });
    const seen = () => fs.readFileSync(path.join(dir, "seen"), "utf8").trim().split("\n");
    return { root, dir, engine, services, call, writeData, readData, seen };
}

test("SigV4 signing matches AWS's published GetObject example", () => {
    const authorization = signS3Request({
        method: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        headers: {
            host: "examplebucket.s3.amazonaws.com",
            range: "bytes=0-9",
            "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "x-amz-date": "20130524T000000Z",
        },
        payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        amzDate: "20130524T000000Z",
    });
    expect(authorization).toBe(
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
});

test("a backup made by a newer panel version is not restored onto an older one", () => {
    expect(isNewerVersion("0.3.0", "0.2.9")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.1.5", "0.2.0")).toBe(false);
    expect(isNewerVersion("weird", "0.2.0")).toBe(true);
});

describe("archive extraction", () => {
    const entries = { files: `files/${panelFilesDirName(ID)}`, config: `configs/${ID}.json` };

    test("refuses a member that belongs to another panel", async () => {
        const src = tmp("archive-src-");
        fs.mkdirSync(path.join(src, "files", "dev.other"), { recursive: true });
        fs.writeFileSync(path.join(src, "files", "dev.other", "x.txt"), "not yours");
        const archive = path.join(tmp("archive-out-"), "a.tgz");
        await tar.c({ gzip: true, file: archive, cwd: src }, ["files/dev.other"]);
        const staging = tmp("archive-stage-");
        await expect(extractPanelArchive(archive, entries, staging)).rejects.toThrow("not this panel's data");
        expect(fs.readdirSync(staging)).toEqual([]);
    });

    test("refuses a link inside the panel's own storage", async () => {
        const src = tmp("archive-src-");
        fs.mkdirSync(path.join(src, entries.files), { recursive: true });
        fs.symlinkSync("/etc/passwd", path.join(src, entries.files, "link"));
        const archive = path.join(tmp("archive-out-"), "a.tgz");
        await tar.c({ gzip: true, file: archive, cwd: src }, [entries.files]);
        await expect(extractPanelArchive(archive, entries, tmp("archive-stage-"))).rejects.toThrow("SymbolicLink");
    });
});

describe("backups on this computer", () => {
    test("a panel backs up, changes its data, and restores the backup", async () => {
        const f = panelFixture();
        f.writeData("first", { n: 1 });
        expect(f.services.startService(ID)).toBe(true);
        await f.services.waitUntilReady(ID);

        const none = await f.call("backup:create", { panelId: ID }, ID);
        expect(none.code).toBe("CONFLICT");

        expect((await f.call("backup:panel-destination-set", { panelId: ID, destinationId: "local" })).error).toBeUndefined();
        const made = await f.call("backup:create", { panelId: ID, label: "before" }, ID);
        expect(made.error).toBeUndefined();
        expect(made.result.panelVersion).toBe("0.2.0");

        await f.services.stopService(ID);
        f.writeData("second", { n: 2 });
        f.services.startService(ID);
        await f.services.waitUntilReady(ID);

        const listed = await f.call("backup:list", { panelId: ID }, ID);
        expect(listed.result.backups.map((b: BackupRecord) => b.id)).toEqual([made.result.id]);
        const restored = await f.call("backup:restore", { panelId: ID, backupId: made.result.id }, ID);
        expect(restored.error).toBeUndefined();
        expect(f.readData()).toEqual({ mode: "first", config: { n: 1 } });
        // the backup paused the service, the restore restarted it on the restored data
        expect(f.seen()).toEqual(["first", "first", "second", "first"]);
        expect(fs.readdirSync(path.join(f.root, "files")).filter((n) => n.startsWith(".restore-parked"))).toEqual([]);

        expect((await f.call("backup:delete", { panelId: ID, backupId: made.result.id }, ID)).error).toBeUndefined();
        expect((await f.call("backup:list", { panelId: ID }, ID)).result.backups).toEqual([]);
    });

    test("a restore whose service never becomes ready puts the previous data back and restarts on it", async () => {
        const f = panelFixture();
        f.writeData("broken", { n: 1 });
        await f.call("backup:panel-destination-set", { panelId: ID, destinationId: "local" });
        const made = await f.call("backup:create", { panelId: ID }, ID);
        expect(made.error).toBeUndefined();

        f.writeData("good", { n: 2 });
        f.services.startService(ID);
        await f.services.waitUntilReady(ID);

        const restored = await f.call("backup:restore", { panelId: ID, backupId: made.result.id }, ID);
        expect(restored.error).toContain("exited before readiness");
        expect(f.readData()).toEqual({ mode: "good", config: { n: 2 } });
        expect(f.services.isActive(ID)).toBe(true);
        expect(f.seen()).toEqual(["good", "good"]);
    });

    test("a backup from a newer panel version is refused before any data moves", async () => {
        const f = panelFixture("0.3.0");
        f.writeData("new", { n: 3 });
        await f.call("backup:panel-destination-set", { panelId: ID, destinationId: "local" });
        const made = await f.call("backup:create", { panelId: ID }, ID);
        fs.writeFileSync(path.join(f.dir, "manifest.json"), JSON.stringify({ id: ID, name: "Backups", version: "0.2.0", service: "service.mjs" }));
        f.writeData("old", { n: 2 });
        const restored = await f.call("backup:restore", { panelId: ID, backupId: made.result.id }, ID);
        expect(restored.code).toBe("CONFLICT");
        expect(f.readData()).toEqual({ mode: "old", config: { n: 2 } });
    });
});

describe("backup scoping", () => {
    test("a panel cannot reach another panel's backups", async () => {
        const f = panelFixture();
        for (const action of ["backup:status", "backup:create", "backup:list", "backup:restore", "backup:delete"]) {
            const answer = await f.call(action, { panelId: ID, backupId: newBackupId() }, "dev.test.other");
            expect(answer.code).toBe("FORBIDDEN");
        }
    });

    test("only the host chooses and manages backup locations", async () => {
        const f = panelFixture();
        const host = [
            ["backup:destinations", {}],
            ["backup:destination-usage", { destinationId: "local" }],
            ["backup:destination-add", { destination: { kind: "s3" } }],
            ["backup:destination-remove", { destinationId: "d-000000000000" }],
            ["backup:panel-destination-set", { panelId: ID, destinationId: "local" }],
        ] as const;
        for (const [action, params] of host) expect((await f.call(action, params, ID)).code).toBe("FORBIDDEN");
        expect((await f.call("backup:destinations", {})).result.destinations.map((d: any) => d.id)).toEqual(["local"]);
    });
});

async function serve(handler: (req: http.IncomingMessage, body: Buffer, res: http.ServerResponse) => void) {
    const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        handler(req, Buffer.concat(chunks), res);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function sampleArchive(): Promise<{ record: BackupRecord; archive: string }> {
    const data = tmp("store-data-");
    fs.mkdirSync(path.join(data, "files", panelFilesDirName(ID)), { recursive: true });
    fs.writeFileSync(path.join(data, "files", panelFilesDirName(ID), "a.txt"), "hello");
    const archive = path.join(tmp("store-archive-"), "a.pbbackup");
    const { size, sha256 } = await createPanelArchive(data, { files: `files/${panelFilesDirName(ID)}`, config: `configs/${ID}.json` }, archive);
    const record: BackupRecord = { format: 1, id: newBackupId(), panelId: ID, createdAt: new Date().toISOString(), size, sha256, panelVersion: "0.2.0", label: null };
    return { record, archive };
}

test("S3 store round-trips a backup through a signed bucket", async () => {
    const objects = new Map<string, Buffer>();
    const base = await serve((req, body, res) => {
        if (!String(req.headers.authorization).startsWith("AWS4-HMAC-SHA256 Credential=AKID/")) {
            res.writeHead(403).end();
            return;
        }
        const url = new URL(req.url!, "http://x");
        const key = decodeURIComponent(url.pathname.replace(/^\/bucket\/?/, ""));
        if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
            const prefix = url.searchParams.get("prefix") ?? "";
            const items = [...objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`);
            res.writeHead(200).end(`<ListBucketResult><IsTruncated>false</IsTruncated>${items.join("")}</ListBucketResult>`);
        } else if (req.method === "PUT") {
            objects.set(key, body);
            res.writeHead(200).end();
        } else if (req.method === "GET") {
            const found = objects.get(key);
            res.writeHead(found ? 200 : 404).end(found);
        } else if (req.method === "DELETE") {
            objects.delete(key);
            res.writeHead(204).end();
        } else res.writeHead(400).end();
    });
    const store = new S3BackupStore({ endpoint: base, region: "us-east-1", bucket: "bucket", prefix: "pb", accessKeyId: "AKID", pathStyle: true }, { secretAccessKey: "secret" });
    const { record, archive } = await sampleArchive();
    await store.check();
    await store.put(record, archive);
    expect(await store.list(ID)).toEqual([record]);
    expect(await store.list("dev.test.other")).toEqual([]);
    expect((await store.usage()).used).toBe(record.size);
    const back = path.join(tmp("s3-get-"), "b.pbbackup");
    await store.get(record, back);
    expect(fs.readFileSync(back).equals(fs.readFileSync(archive))).toBe(true);
    await store.remove(record);
    expect(await store.list(ID)).toEqual([]);
});

test("Google Drive store round-trips a backup in its folder", async () => {
    const files = new Map<string, { meta: any; body: Buffer }>();
    const sessions = new Map<string, any>();
    let next = 0;
    let base = "";
    base = await serve((req, body, res) => {
        const url = new URL(req.url!, "http://x");
        const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
        if (url.pathname === "/token") {
            const form = new URLSearchParams(body.toString());
            if (form.get("refresh_token") !== "refresh") return json(400, { error: "invalid_grant" });
            return json(200, { access_token: "access", expires_in: 3600 });
        }
        if (req.headers.authorization !== "Bearer access" && !url.pathname.startsWith("/session/")) return json(401, {});
        if (url.pathname === "/upload/files" && req.method === "POST") {
            const id = `s${next++}`;
            sessions.set(id, JSON.parse(body.toString()));
            res.writeHead(200, { location: `${base}/session/${id}` }).end();
            return;
        }
        if (url.pathname.startsWith("/session/") && req.method === "PUT") {
            const id = `f${next++}`;
            files.set(id, { meta: sessions.get(url.pathname.slice(9)), body });
            return json(200, { id });
        }
        if (url.pathname === "/api/files" && req.method === "POST") {
            const id = `folder${next++}`;
            files.set(id, { meta: { ...JSON.parse(body.toString()), parents: [] }, body: Buffer.alloc(0) });
            return json(200, { id });
        }
        if (url.pathname === "/api/files" && req.method === "GET") {
            const q = url.searchParams.get("q") ?? "";
            const want = [...q.matchAll(/key='(\w+)' and value='([^']*)'/g)];
            const parent = /'([^']+)' in parents/.exec(q)?.[1];
            const matched = [...files].filter(([, f]) => f.meta.parents?.includes(parent) && want.every(([, k, v]) => f.meta.appProperties?.[k] === v));
            return json(200, { files: matched.map(([id, f]) => ({ id, description: f.meta.description, size: String(f.body.length) })) });
        }
        if (url.pathname === "/api/about") return json(200, { storageQuota: { limit: "1000000", usage: "1000" } });
        const fileId = url.pathname.replace(/^\/api\/files\//, "");
        const file = files.get(fileId);
        if (!file) return json(404, {});
        if (req.method === "DELETE") {
            files.delete(fileId);
            return res.writeHead(204).end();
        }
        if (url.searchParams.get("alt") === "media") return res.writeHead(200).end(file.body);
        return json(200, { id: fileId, trashed: false });
    });
    const endpoints = { tokenUrl: `${base}/token`, apiBase: `${base}/api`, uploadBase: `${base}/upload` };
    const settings = { clientId: "client", folderId: "" };
    const store = new DriveBackupStore("d-0123456789ab", settings, { clientSecret: "s", refreshToken: "refresh" }, endpoints);
    settings.folderId = await store.createFolder();
    await store.check();
    const { record, archive } = await sampleArchive();
    await store.put(record, archive);
    expect(await store.list(ID)).toEqual([record]);
    expect(await store.list("dev.test.other")).toEqual([]);
    expect(await store.usage()).toEqual({ used: record.size, available: 999000 });
    const back = path.join(tmp("drive-get-"), "b.pbbackup");
    await store.get(record, back);
    expect(fs.readFileSync(back).equals(fs.readFileSync(archive))).toBe(true);
    await store.remove(record);
    expect(await store.list(ID)).toEqual([]);

    const refused = new DriveBackupStore("d-ba9876543210", settings, { clientSecret: "s", refreshToken: "revoked" }, endpoints);
    await expect(refused.list(ID)).rejects.toThrow("connect Google Drive again");
});
