// A real Paperboard daemon for the suite (packages/testkit/src/craneBinary.ts), built
// from this checkout into a temp dir and started on a free loopback port with
// the test process's throwaway PAPERBOARD_DIR (test/hermetic.ts) as its data
// directory. paperapi in the test process then reads that directory's
// crane.json and talks to it over the real wire; hermetic.ts lets a socket
// through only to a port registered here.
import { setDefaultTimeout } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildCrane, startCrane } from "testkit/craneBinary";

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
    const crane = await startCrane(buildCrane(binDir), dataDir);
    const port = crane.port;
    const handshake = JSON.parse(fs.readFileSync(path.join(dataDir, "local", "crane.json"), "utf8"));
    if (handshake.port !== port) throw new Error(`crane.json names port ${handshake.port}, the daemon listens on ${port}`);
    const allowed: Set<number> = (globalThis as any)[ALLOWED];
    if (!allowed) throw new Error("test/hermetic.ts is not preloaded");
    allowed.add(port);
    return {
        port,
        dataDir,
        output: crane.output,
        async stop() {
            for (const work of beforeStop.splice(0)) await work();
            allowed.delete(port);
            await crane.stop();
        },
    };
}
