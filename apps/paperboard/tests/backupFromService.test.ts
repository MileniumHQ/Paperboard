// An action that backs up its own panel is answered with the backup (bun
// test, a real compiled daemon, a real panel service). A backup stops the
// panel's service while its data is copied, and the service that was
// answering the action is that service, so its action always came back as
// "Action service ... disconnected" although the backup had succeeded.
// The service passes the call it is answering along with the request, and
// the daemon answers that call with the backup once the service is gone.
import { test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { CraneTransport } from "../../../packages/paperapi/src/ws";
import { panelFilesDirName } from "../papercrane/storage";
import { compileCrane, startCrane, tempDir, type CraneDaemon } from "./craneDaemon";

const PANEL = "dev.test.selfbackup";
const FIXTURE = path.resolve(import.meta.dir, "fixtures/selfBackupService.ts");

let root = "";
let daemon: CraneDaemon | undefined;
let host: CraneTransport | undefined;

beforeAll(async () => {
    root = tempDir("pb-self-backup-");
    const bin = await compileCrane(root);
    const home = path.join(root, "home");
    const panelDir = path.join(home, "panels", PANEL);
    fs.mkdirSync(panelDir, { recursive: true });
    fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ id: PANEL, name: "Self backup", version: "1.0.0", service: "./service.js" }));
    // a backup needs something to copy
    const filesDir = path.join(home, "files", panelFilesDirName(PANEL));
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, "world.txt"), "saved");
    const bundle = Bun.spawnSync([process.execPath, "build", FIXTURE, "--target=node", "--outfile", path.join(panelDir, "service.js")], { cwd: path.resolve(import.meta.dir, "..") });
    if (bundle.exitCode !== 0) throw new Error(`bundling the fixture service failed: ${bundle.stderr.toString()}`);
    daemon = await startCrane(bin, home);
    host = new CraneTransport({ port: daemon.port, token: daemon.token, computerId: "local" });
}, 90_000);

afterAll(async () => {
    host?.close();
    if (daemon) {
        daemon.proc.kill("SIGTERM");
        await daemon.proc.exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
});

async function callAction(): Promise<any> {
    const deadline = Date.now() + 30_000;
    for (;;) {
        try {
            return await host!.call("actions:call", { panelId: PANEL, action: "backup-self", args: [] }, 60_000);
        } catch (err) {
            // the service registers its actions a moment after the daemon is up
            if (!/not registered or unavailable/.test((err as Error).message) || Date.now() > deadline) throw err;
            await Bun.sleep(100);
        }
    }
}

test("an action that backs up its own panel resolves with the backup, and the service is back for the next", async () => {
    await host!.call("backup:panel-destination-set", { panelId: PANEL, destinationId: "local" });

    const first = await callAction();
    expect(first.result).toMatchObject({ panelId: PANEL, label: "from the action" });

    // the service restarted behind the answer: it takes the next call too
    const second = await callAction();
    expect(second.result.id).not.toBe(first.result.id);
    const listed = await host!.call("backup:list", { panelId: PANEL });
    expect(listed.backups.map((b: { id: string }) => b.id).sort()).toEqual([first.result.id, second.result.id].sort());
}, 120_000);
