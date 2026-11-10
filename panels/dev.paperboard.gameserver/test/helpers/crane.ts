// A real Paperboard daemon for the suite: the compiled crane, built from
// this checkout into a temp dir and started on a free loopback port with the
// test process's throwaway PAPERBOARD_DIR (test/hermetic.ts) as its data
// directory. paperapi in the test process then reads that directory's
// crane.json and talks to it over the real wire; hermetic.ts lets a socket
// through only to a port registered here.
//
// The compiled binary, not the source entry: the daemon starts every
// workload under a supervisor by re-running its own executable with
// `--supervise`, which only a compiled crane (or the desktop app) can do.
import { setDefaultTimeout } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "../../../..");
const CRANE_ENTRY = path.join(REPO, "apps/paperboard/papercrane/main.ts");
const START_TIMEOUT_MS = 30_000;
const ALLOWED = Symbol.for("paperboard.gameserver.test.daemonPorts");
const DAEMON_BUILDS = Symbol.for("paperboard.gameserver.test.daemonBuilds");

// a test on the daemon starts real processes and waits on their output;
// each wait has its own bound (helpers/scope.ts waitFor), under this one
setDefaultTimeout(60_000);

const beforeStop: (() => Promise<void>)[] = [];
/** work that must run while the daemon is still up when it stops (ending the workloads a test left running) */
export function onDaemonStop(work: () => Promise<void>): void {
    beforeStop.push(work);
}

export interface TestDaemon {
    port: number;
    dataDir: string;
    /** everything the daemon printed, for failure messages */
    output(): string;
    stop(): Promise<void>;
}

function buildCrane(outDir: string): string {
    const binary = path.join(outDir, process.platform === "win32" ? "papercrane.exe" : "papercrane");
    const build = spawnSync(process.execPath, ["build", "--compile", CRANE_ENTRY, "--outfile", binary], {
        cwd: path.join(REPO, "apps/paperboard"),
        encoding: "utf8",
    });
    if (build.status !== 0 || !fs.existsSync(binary)) {
        throw new Error(`Building the crane daemon failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    return binary;
}

/** Starts a daemon for this test file. Call stop() in afterAll. */
export async function startTestDaemon(): Promise<TestDaemon> {
    const dataDir = process.env.PAPERBOARD_DIR;
    if (!dataDir || !dataDir.startsWith(os.tmpdir())) {
        throw new Error(`PAPERBOARD_DIR must be the throwaway dir test/hermetic.ts made, not ${dataDir}`);
    }
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "gameserver-crane-"));
    // the supervisors it starts re-run this executable and outlive the
    // daemon by design (a test may restart it and expect them adopted), so
    // the binary goes once the file's tests are done: test/hermetic.ts
    const builds: string[] = ((globalThis as any)[DAEMON_BUILDS] ??= []);
    builds.push(binDir);
    const binary = buildCrane(binDir);
    // the daemon and every process it starts reach no network: a request
    // that is not for loopback goes to a proxy nothing listens on and fails
    const nowhere = "http://127.0.0.1:9";
    const env: Record<string, string | undefined> = {
        ...process.env,
        PAPERBOARD_DIR: dataDir,
        HTTP_PROXY: nowhere,
        HTTPS_PROXY: nowhere,
        ALL_PROXY: nowhere,
        http_proxy: nowhere,
        https_proxy: nowhere,
        all_proxy: nowhere,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child: ChildProcess = spawn(
        binary,
        ["--data-dir", dataDir, "--port", "0", "--host", "127.0.0.1", "--headless"],
        { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`The test daemon did not start within ${START_TIMEOUT_MS / 1000}s:\n${log}`)),
            START_TIMEOUT_MS,
        );
        const onData = (chunk: Buffer) => {
            log += chunk.toString("utf8");
            const listening = /Listening on https?:\/\/127\.0\.0\.1:(\d+)/.exec(log);
            if (!listening) return;
            clearTimeout(timer);
            resolve(Number(listening[1]));
        };
        child.stdout!.on("data", onData);
        child.stderr!.on("data", onData);
        child.once("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        void exited.then((code) => {
            clearTimeout(timer);
            reject(new Error(`The test daemon exited (${code}) before it listened:\n${log}`));
        });
    });
    const handshake = JSON.parse(fs.readFileSync(path.join(dataDir, "local", "crane.json"), "utf8"));
    if (handshake.port !== port) throw new Error(`crane.json names port ${handshake.port}, the daemon listens on ${port}`);
    const allowed: Set<number> = (globalThis as any)[ALLOWED];
    if (!allowed) throw new Error("test/hermetic.ts is not preloaded");
    allowed.add(port);
    return {
        port,
        dataDir,
        output: () => log,
        async stop() {
            for (const work of beforeStop.splice(0)) await work();
            allowed.delete(port);
            if (child.exitCode === null && child.signalCode === null) child.kill();
            await exited;
        },
    };
}
