// A backup says how far along it is, and when it holds the panel's service
// stopped (bun test, a real compiled daemon, a real panel service). A backup
// stops the panel's service while it copies the data, and a panel opened in
// that window failed with `Action "__getState" ... is not registered or
// unavailable` and nothing saying a backup was running. The daemon now
// broadcasts each step (with its bytes, throttled) on backup:progress and
// answers backup:progress with the backups running, so the shell can show
// "Backing up" with a progress bar instead.
import { test, expect, beforeAll, afterAll } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { CraneTransport } from "../../../packages/paperapi/src/ws";
import { BACKUP_PROGRESS_EVENT } from "../../../packages/paperapi/src/channels";
import type { BackupProgressChange } from "../../../packages/paperapi/src/backups";
import { panelFilesDirName } from "../papercrane/storage";
import { compileCrane, startCrane, tempDir, type CraneDaemon } from "./craneDaemon";

// the fixture service answers for this id
const PANEL = "dev.test.selfbackup";
const FIXTURE = path.resolve(import.meta.dir, "fixtures/selfBackupService.ts");
const SERVER_BYTES = 24 * 1024 * 1024;

let root = "";
let daemon: CraneDaemon | undefined;
let host: CraneTransport | undefined;

beforeAll(async () => {
    root = tempDir("pb-backup-progress-");
    const bin = await compileCrane(root);
    const home = path.join(root, "home");
    const panelDir = path.join(home, "panels", PANEL);
    fs.mkdirSync(panelDir, { recursive: true });
    fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ id: PANEL, name: "Backup progress", version: "1.0.0", service: "./service.js" }));
    // incompressible bytes, so packing takes long enough to be seen
    const filesDir = path.join(home, "files", panelFilesDirName(PANEL));
    fs.mkdirSync(path.join(filesDir, "server", "world"), { recursive: true });
    fs.writeFileSync(path.join(filesDir, "server", "world", "region.bin"), crypto.randomBytes(SERVER_BYTES));
    fs.writeFileSync(path.join(filesDir, "server", "server.properties"), "motd=hi\n");
    fs.mkdirSync(path.join(home, "configs"), { recursive: true });
    fs.writeFileSync(path.join(home, "configs", `${PANEL}.json`), JSON.stringify({ servers: [{ id: "main", name: "Main" }] }));
    const bundle = Bun.spawnSync([process.execPath, "build", FIXTURE, "--target=node", "--outfile", path.join(panelDir, "service.js")], { cwd: path.resolve(import.meta.dir, "..") });
    if (bundle.exitCode !== 0) throw new Error(`bundling the fixture service failed: ${bundle.stderr.toString()}`);
    daemon = await startCrane(bin, home);
    host = new CraneTransport({ port: daemon.port, token: daemon.token, computerId: "local" });
    await host.ensureConnected();
    await host.call("backup:panel-destination-set", { panelId: PANEL, destinationId: "local" });
}, 90_000);

afterAll(async () => {
    host?.close();
    if (daemon) {
        daemon.proc.kill("SIGTERM");
        await daemon.proc.exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
});

/** runs a backup and returns every progress change heard for it, in order,
 * and what backup:progress answered while the service was held */
async function watchBackup(params: Record<string, unknown>): Promise<{ record: any; changes: BackupProgressChange[]; whileHeld: any[] }> {
    const changes: BackupProgressChange[] = [];
    let whileHeld: Promise<any> | null = null;
    const off = host!.subscribeSource(BACKUP_PROGRESS_EVENT, (payload: BackupProgressChange) => {
        changes.push(payload);
        if (payload.progress?.servicePaused && !whileHeld) whileHeld = host!.call("backup:progress", { panelId: PANEL });
    });
    try {
        // the subscription is declared before the backup starts
        await Bun.sleep(0);
        await host!.call("backup:status", { panelId: PANEL });
        const record = await host!.call("backup:create", { panelId: PANEL, ...params }, 120_000);
        // the end is sent as the job settles, just behind the reply
        const deadline = Date.now() + 5_000;
        while (changes.at(-1)?.progress !== null && Date.now() < deadline) await Bun.sleep(20);
        return { record, changes, whileHeld: whileHeld ? (await whileHeld).progress : [] };
    } finally {
        off();
    }
}

const stepsOf = (changes: BackupProgressChange[]) =>
    changes.flatMap((c) => (c.progress ? [c.progress.step] : [])).filter((step, i, all) => step !== all[i - 1]);
const lastOf = (changes: BackupProgressChange[], step: string) => changes.filter((c) => c.progress?.step === step).at(-1)!.progress!;

test("a named source's backup reports copying, packing and saving, holds the service only while it copies, then ends", async () => {
    await host!.call("backup:source-define", { panelId: PANEL, source: { id: "main", directory: "server", config: ["servers", { id: "main" }], processes: [] } });
    await host!.call("backup:panel-destination-set", { panelId: PANEL, sourceId: "main", destinationId: "local" });
    const { record, changes, whileHeld } = await watchBackup({ sourceId: "main" });

    expect(stepsOf(changes)).toEqual(["preparing", "copying", "packing", "saving"]);
    for (const change of changes) {
        expect(change.panelId).toBe(PANEL);
        expect(change.sourceId).toBe("main");
        if (change.progress) expect(change.progress.servicePaused).toBe(change.progress.step === "copying" || change.progress.step === "packing");
    }
    // every measured step finishes at its total
    const copied = lastOf(changes, "copying");
    expect(copied.total).toBe(SERVER_BYTES + "motd=hi\n".length);
    expect(copied.done).toBe(copied.total);
    const packed = lastOf(changes, "packing");
    expect(packed.total).toBeGreaterThan(SERVER_BYTES);
    expect(packed.done).toBe(packed.total);
    const saved = lastOf(changes, "saving");
    expect(saved).toMatchObject({ done: record.size, total: record.size });
    // the counts only go forward within a step
    for (const step of ["copying", "packing", "saving"]) {
        const done = changes.filter((c) => c.progress?.step === step).map((c) => c.progress!.done ?? 0);
        expect(done).toEqual([...done].sort((a, b) => a - b));
    }

    // asked while the service was held, the daemon named the backup holding it
    expect(whileHeld).toHaveLength(1);
    expect(whileHeld[0]).toMatchObject({ panelId: PANEL, sourceId: "main", kind: "create" });
    // and the end is said: nothing is running any more
    expect(changes.at(-1)).toEqual({ panelId: PANEL, sourceId: "main", progress: null });
    expect((await host!.call("backup:progress", { panelId: PANEL })).progress).toEqual([]);
}, 120_000);

test("the panel's own backup packs straight from its data, with no copy step", async () => {
    const { changes } = await watchBackup({});
    expect(stepsOf(changes)).toEqual(["preparing", "packing", "saving"]);
    expect(changes.every((c) => c.sourceId === null)).toBe(true);
    expect(changes.at(-1)?.progress).toBeNull();
}, 120_000);
