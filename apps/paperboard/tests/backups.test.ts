import { afterEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import * as tar from "tar";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { PanelServicesManager } from "../papercrane/panelServices";
import { panelFilesDirName, TAR_BUDGET } from "../papercrane/storage";
import { computerHostname } from "../papercrane/hostname";
import { handleBackups } from "../papercrane/rpc/backups";
import { extractPanelArchive } from "../papercrane/backups/archive";
import { S3BackupStore, signS3Request } from "../papercrane/backups/s3Store";
import { DriveBackupStore } from "../papercrane/backups/driveStore";
import { LocalBackupStore } from "../papercrane/backups/localStore";
import { BackupService, isNewerVersion } from "../papercrane/backups/service";
import { MAX_KEEP, SCHEDULE_HOURS, SCHEDULED_LABEL } from "../papercrane/backups/schedules";
import { MAX_ROUTINE_BACKUPS_KEPT, ROUTINE_BACKUP_HOURS, ROUTINE_BACKUP_LABEL } from "../../../packages/paperapi/src/backups";
import { BackupListingError, newBackupId, type BackupRecord } from "../papercrane/backups/types";
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
// with a prepare.txt the service takes part in backups: "ok" or "fail"
const prepare = ${JSON.stringify(path.join(filesDir, "prepare.txt"))};
process.on('message', (message) => {
    if (message?.type !== 'paperboard:before-backup') return;
    const answer = fs.readFileSync(prepare, 'utf8');
    fs.appendFileSync('seen', 'prepare:' + answer + '\\n');
    process.send({ type: 'paperboard:before-backup-done', requestId: message.requestId, ...(answer === 'ok' ? {} : { error: 'the world would not save' }) });
});
process.send({ type: 'paperboard:service-ready', panelId: ${JSON.stringify(ID)}, beforeBackup: fs.existsSync(prepare) });
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
    const setPrepare = (answer: "ok" | "fail") => fs.writeFileSync(path.join(filesDir, "prepare.txt"), answer);
    return { root, dir, engine, services, call, writeData, readData, seen, setPrepare };
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

    test("refuses an archive with more entries than the budget instead of dropping the extras", async () => {
        const src = tmp("archive-src-");
        fs.mkdirSync(path.join(src, entries.files), { recursive: true });
        for (const name of ["a", "b", "c", "d"]) fs.writeFileSync(path.join(src, entries.files, name), name);
        const archive = path.join(tmp("archive-out-"), "a.tgz");
        await tar.c({ gzip: true, file: archive, cwd: src }, [entries.files]);
        const staging = tmp("archive-stage-");
        const limit = TAR_BUDGET.maxEntries;
        TAR_BUDGET.maxEntries = 3;
        try {
            await expect(extractPanelArchive(archive, entries, staging)).rejects.toThrow("extraction budget");
        } finally {
            TAR_BUDGET.maxEntries = limit;
        }
        expect(fs.readdirSync(staging)).toEqual([]);
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

    test("a restore that cannot park the config puts the parked files back and restarts the panel", async () => {
        const f = panelFixture();
        f.writeData("one", { n: 1 });
        await f.call("backup:panel-destination-set", { panelId: ID, destinationId: "local" });
        const made = await f.call("backup:create", { panelId: ID }, ID);
        expect(made.error).toBeUndefined();

        f.writeData("two", { n: 2 });
        f.services.startService(ID);
        await f.services.waitUntilReady(ID);

        // the files park, then the config's rename is refused
        const configsDir = path.join(f.root, "configs");
        fs.chmodSync(configsDir, 0o500);
        cleanups.push(() => fs.chmodSync(configsDir, 0o700));
        const restored = await f.call("backup:restore", { panelId: ID, backupId: made.result.id }, ID);
        fs.chmodSync(configsDir, 0o700);
        expect(restored.error).toBeTruthy();
        expect(f.readData()).toEqual({ mode: "two", config: { n: 2 } });
        expect(fs.readdirSync(path.join(f.root, "files")).filter((n) => n.startsWith(".restore-parked"))).toEqual([]);
        expect(f.services.isActive(ID)).toBe(true);
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

describe("a service that takes part in backups", () => {
    test("is asked to get ready before its data is copied", async () => {
        const f = panelFixture();
        f.writeData("first", { n: 1 });
        f.setPrepare("ok");
        expect(f.services.startService(ID)).toBe(true);
        await f.services.waitUntilReady(ID);
        await f.call("backup:panel-destination-set", { panelId: ID, destinationId: "local" });
        const made = await f.call("backup:create", { panelId: ID }, ID);
        expect(made.error).toBeUndefined();
        // asked while running, then stopped for the copy and started again
        expect(f.seen()).toEqual(["first", "prepare:ok", "first"]);
    });

    test("that cannot get ready refuses the backup and is started again", async () => {
        const f = panelFixture();
        f.writeData("first", { n: 1 });
        f.setPrepare("fail");
        expect(f.services.startService(ID)).toBe(true);
        await f.services.waitUntilReady(ID);
        await f.call("backup:panel-destination-set", { panelId: ID, destinationId: "local" });
        const made = await f.call("backup:create", { panelId: ID }, ID);
        expect(made.code).toBe("CONFLICT");
        expect(made.error).toContain("the world would not save");
        // the restart undoes whatever the half-done preparation left
        expect(f.seen()).toEqual(["first", "prepare:fail", "first"]);
        expect((await f.call("backup:list", { panelId: ID }, ID)).result.backups).toEqual([]);
    });
});

describe("routine backups", () => {
    const HOUR = 60 * 60 * 1000;
    function scheduled() {
        const f = panelFixture();
        f.writeData("first", { n: 1 });
        let clock = Date.parse("2026-10-14T12:00:00Z");
        const backups = new BackupService(f.engine, undefined, { now: () => clock });
        cleanups.push(() => backups.dispose());
        const schedulesFile = path.join(f.root, "backups", "schedules.json");
        return { ...f, backups, schedulesFile, advance: (ms: number) => (clock += ms) };
    }

    test("offer panels the same choices the daemon accepts", () => {
        expect([...ROUTINE_BACKUP_HOURS]).toEqual([...SCHEDULE_HOURS]);
        expect(MAX_ROUTINE_BACKUPS_KEPT).toBe(MAX_KEEP);
        expect(ROUTINE_BACKUP_LABEL).toBe(SCHEDULED_LABEL);
    });

    test("need a backup location first", async () => {
        const f = scheduled();
        await expect(f.backups.setSchedule(ID, { everyHours: 24, keep: 3 })).rejects.toThrow("Choose where");
        expect(fs.existsSync(f.schedulesFile)).toBe(false);
    });

    test("run when due and keep only the newest routine backups", async () => {
        const f = scheduled();
        await f.backups.setPanelDestination(ID, "local");
        const manual = await f.backups.create(ID, "before the update");
        await f.backups.setSchedule(ID, { everyHours: 6, keep: 2 });
        expect(f.backups.status(ID).schedule).toMatchObject({ everyHours: 6, keep: 2, nextRunAt: "2026-10-14T18:00:00.000Z", last: null });

        await f.backups.runDue();
        expect(await f.backups.list(ID)).toHaveLength(1); // not due yet

        for (let i = 0; i < 3; i++) {
            f.advance(6 * HOUR);
            await f.backups.runDue();
        }
        const list = await f.backups.list(ID);
        expect(list.filter((b) => b.label === SCHEDULED_LABEL)).toHaveLength(2);
        // a backup someone made is never pruned
        expect(list.map((b) => b.id)).toContain(manual.id);
        const schedule = f.backups.status(ID).schedule!;
        expect(schedule.last).toMatchObject({ ok: true, message: null });
        expect(schedule.nextRunAt).toBe("2026-10-15T12:00:00.000Z");
    });

    test("that fail record why and try again sooner", async () => {
        const f = scheduled();
        await f.backups.setPanelDestination(ID, "local");
        await f.backups.setSchedule(ID, { everyHours: 24, keep: 3 });
        await f.backups.setPanelDestination(ID, null);
        f.advance(24 * HOUR);
        await f.backups.runDue();
        const schedule = f.backups.status(ID).schedule!;
        expect(schedule.last).toMatchObject({ ok: false, message: "No backup location chosen for this panel" });
        expect(schedule.nextRunAt).toBe("2026-10-15T12:15:00.000Z");
    });

    test("a label someone gives cannot pass for a routine backup", async () => {
        const f = scheduled();
        await f.backups.setPanelDestination(ID, "local");
        await expect(f.backups.create(ID, " routine backup ")).rejects.toThrow("kept for routine backups");
    });

    test("an unreadable schedules file is refused, never overwritten", async () => {
        const f = scheduled();
        await f.backups.setPanelDestination(ID, "local");
        fs.mkdirSync(path.dirname(f.schedulesFile), { recursive: true });
        fs.writeFileSync(f.schedulesFile, "{ not json");
        await expect(f.backups.setSchedule(ID, { everyHours: 24, keep: 3 })).rejects.toThrow("not readable JSON");
        expect(fs.readFileSync(f.schedulesFile, "utf8")).toBe("{ not json");
        expect(() => f.backups.status(ID)).toThrow("not readable JSON");
    });

    test("go with the panel's data, and stay when only its code is removed", async () => {
        const f = scheduled();
        await f.backups.setPanelDestination(ID, "local");
        await f.backups.setSchedule(ID, { everyHours: 24, keep: 3 });
        const manifest = fs.readFileSync(path.join(f.dir, "manifest.json"));
        const service = fs.readFileSync(path.join(f.dir, "service.mjs"));
        await f.engine.uninstallPanel(ID);
        expect(f.backups.status(ID).schedule).not.toBeNull();

        fs.mkdirSync(f.dir, { recursive: true });
        fs.writeFileSync(path.join(f.dir, "manifest.json"), manifest);
        fs.writeFileSync(path.join(f.dir, "service.mjs"), service);
        await f.engine.uninstallPanel(ID, { deleteData: true });
        expect(f.backups.status(ID).schedule).toBeNull();
    });

    test("the daemon's timer runs a due backup on its own", async () => {
        const f = scheduled();
        await f.backups.setPanelDestination(ID, "local");
        await f.backups.setSchedule(ID, { everyHours: 1, keep: 3 });
        f.advance(HOUR);
        f.backups.startScheduler();
        const deadline = Date.now() + 10_000;
        while ((await f.backups.list(ID)).length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
        expect((await f.backups.list(ID)).map((b) => b.label)).toEqual([SCHEDULED_LABEL]);
    });

    test("can be set and read through the panel's own RPC only", async () => {
        const f = panelFixture();
        await f.call("backup:panel-destination-set", { panelId: ID, destinationId: "local" });
        const other = await f.call("backup:schedule-set", { panelId: ID, schedule: { everyHours: 24, keep: 3 } }, "dev.test.other");
        expect(other.code).toBe("FORBIDDEN");
        const bad = await f.call("backup:schedule-set", { panelId: ID, schedule: { everyHours: 5, keep: 3 } }, ID);
        expect(bad.code).toBe("INVALID_PARAMS");
        const set = await f.call("backup:schedule-set", { panelId: ID, schedule: { everyHours: 24, keep: 3 } }, ID);
        expect(set.result.schedule).toMatchObject({ everyHours: 24, keep: 3 });
        const off = await f.call("backup:schedule-set", { panelId: ID, schedule: null }, ID);
        expect(off.result.schedule).toBeNull();
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

    test("a damaged locations file is not a fresh install: it is kept, mutations refuse, and recovery is explicit", async () => {
        const f = panelFixture();
        f.writeData("one", { n: 1 });
        const file = path.join(f.root, "backups", "destinations.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // a missing file is a fresh install
        expect((await f.call("backup:destinations-problem", {})).result.problem).toBeNull();
        fs.writeFileSync(file, "{ not json");

        expect((await f.call("backup:destinations-problem", {})).result.problem).toContain("destinations.json");
        for (const [action, params] of [
            ["backup:destinations", {}],
            ["backup:panel-destination-set", { panelId: ID, destinationId: "local" }],
        ] as const) {
            expect((await f.call(action, params)).error).toContain("could not be read");
        }
        expect(fs.readFileSync(file, "utf8")).toBe("{ not json");

        const recovered = await f.call("backup:destinations-recover", {});
        expect(recovered.error).toBeUndefined();
        expect(fs.readFileSync(path.join(path.dirname(file), recovered.result.keptAs), "utf8")).toBe("{ not json");
        expect(fs.existsSync(file)).toBe(false);
        expect((await f.call("backup:destinations", {})).result.destinations.map((d: any) => d.id)).toEqual(["local"]);
        // a readable file has nothing to recover
        expect((await f.call("backup:destinations-recover", {})).code).toBe("CONFLICT");
    });

    test("only the host chooses and manages backup locations", async () => {
        const f = panelFixture();
        const host = [
            ["backup:destinations", {}],
            ["backup:destinations-problem", {}],
            ["backup:destinations-recover", {}],
            ["backup:destination-usage", { destinationId: "local" }],
            ["backup:destination-add", { destination: { kind: "s3" } }],
            ["backup:destination-reconnect", { destinationId: "d-000000000000" }],
            ["backup:destination-remove", { destinationId: "d-000000000000" }],
            ["backup:panel-destination-set", { panelId: ID, destinationId: "local" }],
        ] as const;
        for (const [action, params] of host) expect((await f.call(action, params, ID)).code).toBe("FORBIDDEN");
        const [local] = (await f.call("backup:destinations", {})).result.destinations;
        expect(local.id).toBe("local");
        // named after the machine; the shell shows its own name for the computer instead
        expect(local.label).toBe(computerHostname());
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

// A failed archive must leave no file open: not its output, and not a
// member tar had already opened (on Windows an open handle makes every
// later rename of that folder EPERM until the daemon restarts).
const leakCheckable = fs.existsSync("/proc/self/fd");
function openHandlesUnder(dir: string): string[] {
    return fs.readdirSync("/proc/self/fd").flatMap((fd) => {
        try {
            return [fs.readlinkSync(`/proc/self/fd/${fd}`)];
        } catch (err) {
            // the directory listing's own descriptor is closed by now
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw err;
        }
    }).filter((target) => target.startsWith(dir));
}
function bigPanelData(): { data: string; filesDir: string; entries: { files: string; config: string } } {
    const data = tmp("leak-data-");
    const filesDir = path.join(data, "files", panelFilesDirName(ID));
    fs.mkdirSync(filesDir, { recursive: true });
    const chunk = crypto.randomBytes(1024 * 1024);
    for (const name of ["a1", "a2", "z1", "z2", "z3"]) {
        const fd = fs.openSync(path.join(filesDir, `${name}.bin`), "w");
        for (let i = 0; i < 8; i++) fs.writeSync(fd, chunk);
        fs.closeSync(fd);
    }
    return { data, filesDir, entries: { files: `files/${panelFilesDirName(ID)}`, config: `configs/${ID}.json` } };
}

test.skipIf(!leakCheckable || process.getuid?.() === 0)("an archive that fails on an unreadable file leaves no file open", async () => {
    const { data, filesDir, entries } = bigPanelData();
    fs.writeFileSync(path.join(filesDir, "m-locked.bin"), "no");
    fs.chmodSync(path.join(filesDir, "m-locked.bin"), 0);
    const outDir = tmp("leak-out-");
    await expect(createPanelArchive(data, entries, path.join(outDir, "a.pbbackup"))).rejects.toThrow(/EACCES/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect([...openHandlesUnder(data), ...openHandlesUnder(outDir)]).toEqual([]);
});

test.skipIf(!leakCheckable || !fs.existsSync("/dev/full"))("an archive whose output cannot be written leaves no member open", async () => {
    const { data, entries } = bigPanelData();
    await expect(createPanelArchive(data, entries, "/dev/full")).rejects.toThrow(/ENOSPC/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(openHandlesUnder(data)).toEqual([]);
});

test("the computer's own folder refuses to list when a backup record cannot be read", async () => {
    const root = tmp("local-store-");
    const store = new LocalBackupStore(root);
    const { record, archive } = await sampleArchive();
    await store.put(record, archive);
    expect(await store.list(ID)).toEqual([record]);
    const recordFile = path.join(root, panelFilesDirName(ID), `${record.id}.json`);
    fs.writeFileSync(recordFile, "{ not json");
    await expect(store.list(ID)).rejects.toThrow(record.id);
    // files that are not backup records are not this listing's business
    fs.writeFileSync(recordFile, JSON.stringify(record));
    fs.writeFileSync(path.join(root, panelFilesDirName(ID), "notes.json"), "{ not json");
    expect(await store.list(ID)).toEqual([record]);
});

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
    // a record that cannot be read is a failed listing, not a shorter one
    const recordKey = [...objects.keys()].find((k) => k.endsWith(".json"))!;
    const goodRecord = objects.get(recordKey)!;
    objects.set(recordKey, Buffer.from("{ not json"));
    await expect(store.list(ID)).rejects.toThrow(record.id);
    objects.set(recordKey, goodRecord);
    const back = path.join(tmp("s3-get-"), "b.pbbackup");
    await store.get(record, back);
    expect(fs.readFileSync(back).equals(fs.readFileSync(archive))).toBe(true);
    await store.remove(record);
    expect(await store.list(ID)).toEqual([]);
});

test("reconnecting Google Drive keeps the location, its folder and its backups; another account is refused", async () => {
    const f = panelFixture();
    let folders = 0;
    const accounts: Record<string, string> = { "r-old": "acc-old", "r-new": "acc-new", "r-other": "acc-other" };
    const base = await serve((req, _body, res) => {
        const url = new URL(req.url!, "http://x");
        const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
        if (url.pathname === "/token") return json(200, { access_token: accounts[new URLSearchParams(_body.toString()).get("refresh_token") ?? ""], expires_in: 3600 });
        if (url.pathname === "/api/files" && req.method === "POST") return json(200, { id: `folder${++folders}` });
        // acc-other is a different Google account: the folder is not its file
        if (url.pathname === "/api/files/folder1") return req.headers.authorization === "Bearer acc-other" ? json(404, {}) : json(200, { id: "folder1", trashed: false });
        return json(404, {});
    });
    const endpoints = { tokenUrl: `${base}/token`, apiBase: `${base}/api`, uploadBase: `${base}/upload` };
    const service = new BackupService(f.engine, endpoints);
    const added = await service.addDestination({ kind: "gdrive", label: "Drive", clientId: "client", clientSecret: "s", refreshToken: "r-old" });
    const file = path.join(f.root, "backups", "destinations.json");
    const folderId = () => JSON.parse(fs.readFileSync(file, "utf8")).destinations[0].drive.folderId;
    const secret = (name: string) => f.engine.getSecret(`${added.id}.${name}`, "shell-backups").value;
    expect(folderId()).toBe("folder1");

    await expect(service.reconnectDestination(added.id, { clientId: "client", clientSecret: "s", refreshToken: "r-other" })).rejects.toThrow();
    expect(secret("refresh-token")).toBe("r-old");

    const again = await service.reconnectDestination(added.id, { clientId: "client", clientSecret: "s2", refreshToken: "r-new" });
    expect(again.id).toBe(added.id);
    expect(folderId()).toBe("folder1");
    expect(folders).toBe(1);
    expect(secret("refresh-token")).toBe("r-new");
    expect(secret("client-secret")).toBe("s2");
    expect(service.listDestinations().filter((d) => d.kind === "gdrive")).toHaveLength(1);
    await expect(service.reconnectDestination("local", {})).rejects.toThrow("Google Drive");
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
    const archiveFile = [...files.values()].find((f) => f.meta.description)!;
    const goodDescription = archiveFile.meta.description;
    archiveFile.meta.description = "{ not json";
    await expect(store.list(ID)).rejects.toBeInstanceOf(BackupListingError);
    archiveFile.meta.description = goodDescription;
    const back = path.join(tmp("drive-get-"), "b.pbbackup");
    await store.get(record, back);
    expect(fs.readFileSync(back).equals(fs.readFileSync(archive))).toBe(true);
    await store.remove(record);
    expect(await store.list(ID)).toEqual([]);

    const refused = new DriveBackupStore("d-ba9876543210", settings, { clientSecret: "s", refreshToken: "revoked" }, endpoints);
    await expect(refused.list(ID)).rejects.toThrow("Reconnect this backup location");
});
