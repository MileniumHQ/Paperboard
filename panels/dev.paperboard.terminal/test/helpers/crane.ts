// The real Paperboard daemon for the suite: the compiled crane, built from
// this checkout into a temp dir and started on a free loopback port with the
// test process's throwaway PAPERBOARD_DIR (test/hermetic.ts) as its data
// directory. paperapi in the test process reads that directory's crane.json
// and talks to it over the real wire as the host.
//
// The compiled binary, not the source entry: the daemon runs every shell and
// process under a supervisor by re-running its own executable with
// `--supervise`, which only a compiled crane (or the desktop app) can do.
//
// One daemon per test process: bun runs every file of the suite in one
// process, and paperapi's transport is bound to the first daemon it finds.
// Supervised workloads outlive a daemon by design, so every workload this
// suite started is ended with the daemon's own records of them
// (sockets/*.json): between tests through the daemon (clearWorkloads), and
// once more when the suite ends, before the daemon itself is stopped.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { processApi, terminalApi } from "@mileniumhq/paperapi";
import { within } from "./wait";

const REPO = path.resolve(import.meta.dir, "../../../..");
const CRANE_ENTRY = path.join(REPO, "apps/paperboard/papercrane/main.ts");
const START_TIMEOUT_MS = 30_000;
const ALLOWED = Symbol.for("paperboard.terminal.test.ports");
const TEARDOWN = Symbol.for("paperboard.terminal.test.teardown");


export interface TestDaemon {
    port: number;
    dataDir: string;
    /** a throwaway folder the daemon's shells use as HOME */
    home: string;
    /** everything the daemon printed, for failure messages */
    output(): string;
}

let started: Promise<TestDaemon> | null = null;

/** The suite's daemon, started on first use. */
export function testDaemon(): Promise<TestDaemon> {
    started ??= start();
    return started;
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

interface WorkloadRecord {
    id: string;
    pid: number;
    childPid: number;
    isPty: boolean;
}

function workloadRecords(dataDir: string): { file: string; meta: WorkloadRecord }[] {
    const sockets = path.join(dataDir, "sockets");
    if (!fs.existsSync(sockets)) return [];
    return fs
        .readdirSync(sockets)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
            const file = path.join(sockets, name);
            return { file, meta: JSON.parse(fs.readFileSync(file, "utf8")) as WorkloadRecord };
        });
}

/**
 * Ends every shell and process the daemon supervises, through the daemon,
 * and resolves once each supervisor has removed its record: the next test
 * starts with none.
 */
export async function clearWorkloads(): Promise<void> {
    const daemon = await testDaemon();
    for (const { file, meta } of workloadRecords(daemon.dataDir)) {
        if (meta.isPty) await terminalApi.destroy(meta.id);
        else await processApi.kill(meta.id, "SIGKILL");
        await untilGone(file, `the supervisor of ${meta.id} to end`);
    }
}

/** Resolves once `file` no longer exists, watching its folder. */
export function untilGone(file: string, what: string): Promise<void> {
    const gone = new Promise<void>((resolve) => {
        const watcher = fs.watch(path.dirname(file), () => {
            if (fs.existsSync(file)) return;
            watcher.close();
            resolve();
        });
        if (!fs.existsSync(file)) {
            watcher.close();
            resolve();
        }
    });
    return within(what, gone);
}

// the last resort, when the suite ends: each supervisor and its workload by pid
function killWorkloads(dataDir: string): void {
    for (const { meta } of workloadRecords(dataDir)) {
        for (const pid of [meta.childPid, meta.pid]) {
            try {
                process.kill(pid, "SIGKILL");
            } catch (err) {
                // ESRCH: that one already ended
                if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
            }
        }
    }
}

async function start(): Promise<TestDaemon> {
    const dataDir = process.env.PAPERBOARD_DIR;
    if (!dataDir || !dataDir.startsWith(os.tmpdir())) {
        throw new Error(`PAPERBOARD_DIR must be the throwaway dir test/hermetic.ts made, not ${dataDir}`);
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-crane-"));
    const binary = buildCrane(work);
    const home = path.join(work, "home");
    fs.mkdirSync(home);
    // the daemon and every process it starts reach no network, and its
    // shells are a plain sh in a throwaway home: nothing of the developer's
    // shell setup runs
    const nowhere = "http://127.0.0.1:9";
    const env: Record<string, string | undefined> = {
        ...process.env,
        PAPERBOARD_DIR: dataDir,
        HOME: home,
        SHELL: "/bin/sh",
        ENV: "",
        PS1: "$ ",
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
    const child: ChildProcess = spawn(binary, ["--data-dir", dataDir, "--port", "0", "--host", "127.0.0.1", "--headless"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const teardown: (() => Promise<void>)[] = (globalThis as any)[TEARDOWN];
    if (!teardown) throw new Error("test/hermetic.ts is not preloaded");
    teardown.push(async () => {
        killWorkloads(dataDir);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await within("the test daemon to exit", exited);
        fs.rmSync(work, { recursive: true, force: true });
    });
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
        child.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`The test daemon exited (${code}) before it listened:\n${log}`));
        });
    });
    const handshake = JSON.parse(fs.readFileSync(path.join(dataDir, "local", "crane.json"), "utf8"));
    if (handshake.port !== port) throw new Error(`crane.json names port ${handshake.port}, the daemon listens on ${port}`);
    const allowed: Set<number> = (globalThis as any)[ALLOWED];
    if (!allowed) throw new Error("test/hermetic.ts is not preloaded");
    allowed.add(port);
    return { port, dataDir, home, output: () => log };
}
