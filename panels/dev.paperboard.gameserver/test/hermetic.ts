import { afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// Discovery must not even read the developer's .paperboard before the
// no-network guard below refuses a connection.
const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
        // another user's process: it is there, only not ours to signal
        if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
        throw err;
    }
};
const RUN_PREFIX = "gameserver-unit-";
const systemTemp = os.tmpdir();
// A run that was killed never reached its cleanup: what it left is removed
// by the next run, once the process that owned it is gone.
for (const name of fs.readdirSync(systemTemp).filter((n) => n.startsWith(RUN_PREFIX))) {
    const stale = path.join(systemTemp, name);
    const owner = Number(fs.existsSync(path.join(stale, "owner.pid")) ? fs.readFileSync(path.join(stale, "owner.pid"), "utf8") : NaN);
    if (Number.isInteger(owner) && !alive(owner)) fs.rmSync(stale, { recursive: true, force: true });
}
// Everything a test file makes in the temp dir lands in this one folder, and
// so does what the daemon, the stand-ins and Chrome it starts make there: the
// temp dir itself is pointed at it. One removal at the end takes all of it
// (stand-in executables are tens of megabytes each, and bun test fires no
// exit handlers to remove them one by one).
const runRoot = fs.mkdtempSync(path.join(systemTemp, RUN_PREFIX));
fs.writeFileSync(path.join(runRoot, "owner.pid"), String(process.pid));
for (const name of ["TMPDIR", "TEMP", "TMP"]) process.env[name] = runRoot;
const testData = path.join(runRoot, "data");
fs.mkdirSync(testData);
process.env.PAPERBOARD_DIR = testData;
const SUITE_STARTED = Date.now();
const DAEMON_BUILDS = Symbol.for("paperboard.gameserver.test.daemonBuilds");


// The supervisors (and workloads) the test daemons started outlive them by
// design. They are this process's, so they end here, from the records the
// daemon keeps in sockets/, before their executables are removed: Windows
// can't delete a program that is still running.
async function endSupervisors(): Promise<void> {
    const sockets = path.join(testData, "sockets");
    const pids: number[] = [];
    for (const file of fs.existsSync(sockets) ? fs.readdirSync(sockets).filter((f) => f.endsWith(".json")) : []) {
        const meta = JSON.parse(fs.readFileSync(path.join(sockets, file), "utf8"));
        if (!(Date.parse(meta.startedAt) >= SUITE_STARTED)) continue;
        for (const pid of [meta.pid, meta.childPid]) {
            if (typeof pid === "number" && pid > 0 && pid !== process.pid && alive(pid)) {
                process.kill(pid, "SIGKILL");
                pids.push(pid);
            }
        }
    }
    const deadline = Date.now() + 10_000;
    while (pids.some(alive)) {
        if (Date.now() > deadline) throw new Error(`supervisor processes ${pids.filter(alive).join(", ")} did not end`);
        await Bun.sleep(50);
    }
}

// Windows: the processes still running an executable from `dir`, whether
// or not a record names them (a supervisor whose workload ended drops its
// record before it exits). Elsewhere a running program can be deleted.
function runningFrom(dir: string): number[] {
    if (process.platform !== "win32") return [];
    // the OS names executables by long path; the temp dir may be a short
    // 8.3 one (RUNNER~1)
    dir = fs.realpathSync.native(dir);
    const query = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir.replace(/'/g, "''")}\\', 'OrdinalIgnoreCase') } | ForEach-Object { $_.ProcessId }`;
    const out = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", query], { stdout: "pipe", stderr: "pipe" });
    if (out.exitCode !== 0) throw new Error(`listing the processes run from ${dir} failed: ${out.stderr.toString()}`);
    return out.stdout.toString().split(/\s+/).filter(Boolean).map(Number);
}

async function removeBuild(dir: string): Promise<void> {
    const pids = runningFrom(dir);
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    const deadline = Date.now() + 10_000;
    while (pids.some(alive)) {
        if (Date.now() > deadline) throw new Error(`processes ${pids.filter(alive).join(", ")} run from ${dir} did not end`);
        await Bun.sleep(50);
    }
    fs.rmSync(dir, { recursive: true, force: true });
}

// bun test never fires exit handlers; a preload afterAll runs once the
// process's test files are done
afterAll(async () => {
    await endSupervisors();
    for (const dir of ((globalThis as any)[DAEMON_BUILDS] ?? []).splice(0) as string[]) await removeBuild(dir);
    fs.rmSync(runRoot, { recursive: true, force: true });
});

// Hermetic test guard: unit tests must never open network connections.
// The panel SDK discovers a running daemon through ~/.paperboard/local/crane.json,
// so on a dev machine with Paperboard live, a lazy transport connect reaches the
// REAL daemon — registrations CONFLICT with the live panel's socket and API calls
// return answers from real sessions. A test that passes offline and fails online
// is not a test. This preload replaces the WebSocket constructor for the whole
// test process: any connect attempt fails immediately with this message, which
// makes every suite deterministic no matter what is running on the machine.
const original = globalThis.WebSocket;

// The one exception: a daemon a test started itself (test/helpers/crane.ts)
// on a loopback port, with its handshake inside this process's throwaway
// PAPERBOARD_DIR. Its port is registered here by the helper that spawned
// it, so no other daemon, the developer's included, is ever reachable.
const ALLOWED = Symbol.for("paperboard.gameserver.test.daemonPorts");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

class NoNetworkWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
        const target = new URL(String(url));
        if (
            original &&
            target.protocol === "ws:" &&
            target.hostname === "127.0.0.1" &&
            allowedPorts.has(Number(target.port))
        ) {
            return new original(target, protocols) as unknown as NoNetworkWebSocket;
        }
        throw new Error(
            "unit tests must not open network connections (a live daemon " +
                "would make test results environment-dependent); if a test " +
                "needs the wire, inject a stub transport instead",
        );
    }
}

// Keep the constant shape SDK code may inspect, without offering a socket.
(NoNetworkWebSocket as any).OPEN = original?.OPEN ?? 1;
(NoNetworkWebSocket as any).CONNECTING = original?.CONNECTING ?? 0;
(NoNetworkWebSocket as any).CLOSING = original?.CLOSING ?? 2;
(NoNetworkWebSocket as any).CLOSED = original?.CLOSED ?? 3;

(globalThis as any).WebSocket = NoNetworkWebSocket;

// The same guard for HTTP: the panel talks to Mojang, GeyserMC, Modrinth and
// the loader mavens. A test reaches only loopback servers it started itself,
// so a request anywhere else fails here instead of hitting the internet.
// A test may route one third-party host to a loopback server it started
// (test/helpers/http.ts routeHost), so code with a fixed API address talks to
// that server over real HTTP.
const ROUTES = Symbol.for("paperboard.gameserver.test.hostRoutes");
const routes: Map<string, string> = ((globalThis as any)[ROUTES] ??= new Map<string, string>());
const originalFetch = globalThis.fetch;
const guardedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url = new URL(input instanceof Request ? input.url : String(input));
    const routed = routes.get(url.host);
    if (routed) {
        url = new URL(`${url.pathname}${url.search}`, routed);
        input = input instanceof Request ? new Request(url, input) : url;
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        return Promise.reject(new Error(`unit tests must not reach the network (fetch ${url.origin}); serve it from a loopback server`));
    }
    return originalFetch(input, init);
}) as typeof fetch;
globalThis.fetch = Object.assign(guardedFetch, originalFetch);
