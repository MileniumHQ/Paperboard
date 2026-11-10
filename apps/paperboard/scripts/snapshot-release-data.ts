// Writes the release-data snapshot the update smoke opens with every new
// build (tests/platform/app/releaseData.test.ts): a data dir in the format
// this release writes, made by this release's own compiled crane.
//
//   bun scripts/snapshot-release-data.ts
//
// It lands in tests/platform/app/fixtures/release-data-<version>/ and refuses
// to overwrite one that exists: a snapshot is what a shipped release wrote,
// so it is never regenerated in place. A format change ships a migration and
// a new snapshot beside the old ones.
//
// The daemon runs on a free loopback port against a throwaway data dir, and
// the snapshot holds: the token store (a paired computer's credential, a
// panel credential that computer minted, and the panel service's own), a
// panel's configs, the port registry, a backup location choice and a backup
// in it, a supervised workload's record, the Home layout, and the desktop
// app's own files (its settings and its paired computer).
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { loadOrCreateTlsIdentity } from "../papercrane/tlsIdentity";
import { defaultHomeItems } from "../src/renderer/src/components/home/builtins/defaults";
import { HOME_LAYOUT_ID, serializeHomeLayout } from "../src/renderer/src/lib/homeLayout";

const APP_DIR = path.resolve(import.meta.dir, "..");
const VERSION: string = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8")).version;
const OUT = path.join(APP_DIR, "tests", "platform", "app", "fixtures", `release-data-${VERSION}`);
const SNAPSHOT_PANEL = "dev.paperboard.snapshot";

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

if (fs.existsSync(OUT)) fail(`${OUT} exists. A shipped release's snapshot is never regenerated; bump the version or add a migration and a new snapshot.`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "pb-snapshot-"));
const dataDir = path.join(work, "data");
fs.mkdirSync(dataDir);

async function compileCrane(): Promise<string> {
    const target = `${process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux"}-${process.arch}`;
    const file = path.join(work, process.platform === "win32" ? "papercrane.exe" : "papercrane");
    const result = await Bun.build({
        entrypoints: [path.join(APP_DIR, "papercrane", "main.ts")],
        compile: { target: `bun-${target}` as Bun.Build.Target, outfile: file },
    });
    if (!result.success) fail(`crane compile failed:\n${result.logs.map(String).join("\n")}`);
    return file;
}

// a panel with a service: the daemon mints that service its own credential
function writeSnapshotPanel(): void {
    const dir = path.join(dataDir, "panels", SNAPSHOT_PANEL);
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify({
        name: "Snapshot",
        id: SNAPSHOT_PANEL,
        version: "1.0.0",
        description: "Release-data snapshot fixture",
        publisher: "Paperboard",
        base: "./dist/index.html",
        service: "./dist/service.js",
    }, null, 4)}\n`);
    fs.writeFileSync(path.join(dir, "dist", "index.html"), "<!doctype html><title>Snapshot</title>\n");
    fs.writeFileSync(path.join(dir, "dist", "service.js"),
        `process.send({ type: "paperboard:service-ready", panelId: process.env.PAPERBOARD_PANEL_ID });\nsetInterval(() => {}, 1 << 30);\n`);
}

class Socket {
    private next = 1;
    private pending = new Map<number, (msg: any) => void>();
    private constructor(private ws: WebSocket) {
        ws.on("message", (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "response") this.pending.get(msg.id)?.(msg);
        });
    }
    static open(port: number): Promise<Socket> {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        return new Promise((resolve, reject) => {
            ws.once("open", () => resolve(new Socket(ws)));
            ws.once("error", reject);
        });
    }
    call(action: string, params: Record<string, unknown> = {}): Promise<any> {
        const id = this.next++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, (msg) => (msg.error ? reject(new Error(`${action}: ${msg.error}`)) : resolve(msg.result)));
            this.ws.send(JSON.stringify({ id, action, params }));
        });
    }
    close(): void { this.ws.close(); }
}

async function main(): Promise<void> {
    const crane = await compileCrane();
    writeSnapshotPanel();
    const env = { ...process.env, PAPERBOARD_DIR: dataDir };
    delete env.PAPERCRANE_PORT;
    delete env.PAPERCRANE_HOST;
    const child = spawn(crane, ["--headless", "--port", "0", "--host", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    await new Promise<void>((resolve, reject) => {
        const onData = (chunk: Buffer) => {
            output += chunk.toString();
            if (/Listening on http:\/\/127\.0\.0\.1:\d+/.test(output)) resolve();
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        void exited.then(() => reject(new Error(`the crane exited before it listened:\n${output}`)));
    });
    const handshake = JSON.parse(fs.readFileSync(path.join(dataDir, "local", "crane.json"), "utf8"));
    const host = await Socket.open(handshake.port);
    await host.call("auth:verify", { token: handshake.token });

    // a paired computer, and a panel credential it minted
    const { code } = await host.call("system:pairing-start");
    const laptop = await Socket.open(handshake.port);
    await laptop.call("auth:pair", { code, clientName: "Snapshot Laptop" });
    await laptop.call("auth:panel-token", { panelId: SNAPSHOT_PANEL });
    laptop.close();
    // the service is up, with its own credential
    await host.call("panel:restartService", { panelId: SNAPSHOT_PANEL });

    await host.call("config:set", { id: SNAPSHOT_PANEL, data: { greeting: "hello from 0.3.0", count: 3, nested: { list: [1, 2, 3] } } });
    await host.call("config:set", { id: SNAPSHOT_PANEL, path: "worlds/main.json", data: { seed: 1234, name: "Main" } });
    await host.call("config:set", { id: HOME_LAYOUT_ID, data: serializeHomeLayout(defaultHomeItems("local")) });

    // a port claim in the registry
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const free = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await host.call("ports:claim", { panelId: SNAPSHOT_PANEL, name: "game", label: "Game", protocol: "tcp", preferred: free });

    // the panel backs up to this computer's own folder, and has a backup there
    const { destinations } = await host.call("backup:destinations");
    await host.call("backup:panel-destination-set", { panelId: SNAPSHOT_PANEL, destinationId: destinations[0].id });
    await host.call("backup:create", { panelId: SNAPSHOT_PANEL, label: "Before the update" });

    // a supervised workload: its record stays when the daemon stops
    await host.call("process:run", { id: "snapshot-workload", command: process.execPath, args: ["-e", "setInterval(() => {}, 1 << 30)"], cwd: work });
    host.close();

    child.kill("SIGTERM");
    if ((await exited) !== 0) fail(`the crane did not stop cleanly:\n${output}`);
    // the workload outlived its daemon, as it should; it is ours to end now
    const supervisors = fs.readdirSync(path.join(dataDir, "sockets")).filter((f) => f.endsWith(".json"));
    for (const file of supervisors) {
        const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "sockets", file), "utf8"));
        // the supervisor first, so it never gets to retire its record
        process.kill(meta.pid, "SIGKILL");
        process.kill(meta.childPid, "SIGKILL");
    }

    // the desktop app's own files, in the format this release writes
    fs.writeFileSync(path.join(dataDir, "local", "app-settings.json"), JSON.stringify({ darkMode: "dark", reducedMotion: true, runOnStartup: false }, null, 2));
    const remote = loadOrCreateTlsIdentity(path.join(work, "remote"));
    fs.writeFileSync(path.join(dataDir, "local", "paired_computers.json"), JSON.stringify({
        activeId: "local",
        computers: [{
            id: "snapshot-rack",
            name: "Snapshot Rack",
            // loopback, refused: opening the snapshot never reaches a network
            host: "127.0.0.2",
            port: 1,
            token: `pc_${crypto.randomBytes(24).toString("hex")}`,
            cert: remote.cert,
            os: "linux",
            arch: "x64",
        }],
    }, null, 2), { mode: 0o600 });

    copyRegularFiles(dataDir, OUT);
    fs.writeFileSync(path.join(OUT, "README.md"), [
        `# Release data written by Paperboard ${VERSION}`,
        "",
        "Generated by `apps/paperboard/scripts/snapshot-release-data.ts` with that release's compiled crane.",
        "The update smoke (`tests/platform/app/releaseData.test.ts`) opens it with every new build.",
        "Never regenerate it in place: a format change ships a migration and a new snapshot.",
        "Every token and certificate in it is a throwaway made for this snapshot.",
        "",
    ].join("\n"));
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`Wrote ${OUT}`);
}

// sockets, logs and anything that is not a regular file stay behind
function copyRegularFiles(from: string, to: string): void {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "logs") continue;
            copyRegularFiles(src, dest);
        } else if (entry.isFile()) {
            fs.mkdirSync(to, { recursive: true });
            fs.copyFileSync(src, dest);
        }
    }
}

await main();
