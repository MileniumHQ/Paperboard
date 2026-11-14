// A real Paperboard daemon for a test suite: the compiled crane, built from
// this checkout, started on a free port with a throwaway data directory.
// Shared by the Game Server panel's suite and the shell's browser suite.
//
// The compiled binary, not the source entry: the daemon starts every
// workload under a supervisor by re-running its own executable with
// `--supervise`, which only a compiled crane (or the desktop app) can do.
//
// A daemon that never listens is stopped before the start fails, and one the
// suite never stops is stopped as the test process ends.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { craneCompileCommand } from "../supervisor";
import { undoOnExit } from "./cleanup";

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;

/** compiles the crane from this checkout into `outDir`; returns the executable */
export function buildCrane(outDir: string): string {
    const binary = path.join(outDir, process.platform === "win32" ? "papercrane.exe" : "papercrane");
    // the release's own recipe (supervisor embedded), for this computer
    const { cmd: [bun, ...args], cwd } = craneCompileCommand(binary);
    const build = spawnSync(bun!, args, { cwd, encoding: "utf8" });
    if (build.status !== 0 || !fs.existsSync(binary)) {
        throw new Error(`Building the crane daemon failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    return binary;
}

export interface Crane {
    port: number;
    dataDir: string;
    /** everything the daemon printed, for failure messages */
    output(): string;
    stop(): Promise<void>;
}

/** Starts `binary` as a headless daemon over `dataDir`, listening on `host`. */
export async function startCrane(binary: string, dataDir: string, host = "127.0.0.1"): Promise<Crane> {
    if (!dataDir.startsWith(os.tmpdir())) throw new Error(`A test daemon's data dir must be a throwaway temp dir, not ${dataDir}`);
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
    const child: ChildProcess = spawn(binary, ["--data-dir", dataDir, "--port", "0", "--host", host, "--headless"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const running = () => child.exitCode === null && child.signalCode === null;
    // a daemon that failed to spawn never exits: there is nothing to wait for
    const exited = new Promise<number | null>((resolve) => {
        child.once("exit", (code) => resolve(code));
        child.once("error", () => resolve(null));
    });
    const forget = undoOnExit(() => {
        if (running()) child.kill();
    });
    // a daemon that hangs on SIGTERM is killed, and the stop fails saying so
    const stop = async () => {
        forget();
        if (running()) child.kill();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const hung = await Promise.race([
            exited.then(() => false),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(true), STOP_TIMEOUT_MS);
            }),
        ]);
        clearTimeout(timer);
        if (!hung) return;
        child.kill("SIGKILL");
        await exited;
        throw new Error(`The test daemon did not stop within ${STOP_TIMEOUT_MS / 1000}s of SIGTERM and was killed:\n${log}`);
    };
    const listening = new RegExp(`Listening on https?://${host.replace(/\./g, "\\.")}:(\\d+)`);
    const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`The test daemon did not start within ${START_TIMEOUT_MS / 1000}s:\n${log}`)),
            START_TIMEOUT_MS,
        );
        const onData = (chunk: Buffer) => {
            log += chunk.toString("utf8");
            const match = listening.exec(log);
            if (!match) return;
            clearTimeout(timer);
            resolve(Number(match[1]));
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
    }).catch(async (err) => {
        await stop();
        throw err;
    });
    return { port, dataDir, output: () => log, stop };
}
