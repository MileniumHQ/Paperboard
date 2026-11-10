// The real Paperboard daemon in this test process, as the desktop app embeds
// it (startPaperCraneServer: loopback, a port the OS picks, headless), on the
// throwaway PAPERBOARD_DIR test/hermetic.ts made. paperapi in the test
// process finds it through that directory's crane.json and talks to it over
// the real wire as the host. Bot Creator's service runs no workloads, so an
// in-process daemon is all it needs.
//
// One daemon per test process: bun runs every file of the suite in one
// process, and paperapi's transport is bound to the first daemon it finds.
// It stops when the suite ends (test/hermetic.ts).
//
// The daemon is loaded by a path the typechecker does not follow: it is
// another target's source, typechecked by its own gate step.
import * as os from "node:os";
import * as path from "node:path";
import { within } from "./wait";

const DAEMON_ENTRY = path.resolve(import.meta.dir, "../../../../apps/paperboard/papercrane/index.ts");
const ALLOWED = Symbol.for("paperboard.botcreator.test.ports");
const TEARDOWN = Symbol.for("paperboard.botcreator.test.teardown");

interface ServerInstance {
    localPort: number;
    server: { once(event: "close", cb: () => void): void };
    auth: { issuePanelToken(panelId: string): string };
    stop(): void;
}

export interface TestDaemon {
    port: number;
    dataDir: string;
    /** a scoped credential for one panel, as the daemon hands a panel service or window */
    panelToken(panelId: string): string;
}

let started: Promise<TestDaemon> | null = null;

/** The suite's daemon, started on first use. */
export function testDaemon(): Promise<TestDaemon> {
    started ??= start();
    return started;
}

async function start(): Promise<TestDaemon> {
    const dataDir = process.env.PAPERBOARD_DIR;
    if (!dataDir || !dataDir.startsWith(os.tmpdir())) {
        throw new Error(`PAPERBOARD_DIR must be the throwaway dir test/hermetic.ts made, not ${dataDir}`);
    }
    const entry: string = DAEMON_ENTRY;
    const mod = (await import(entry)) as { startPaperCraneServer(options: Record<string, unknown>): Promise<ServerInstance> };
    const instance = await mod.startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    const allowed: Set<number> = (globalThis as any)[ALLOWED];
    const teardown: (() => Promise<void>)[] = (globalThis as any)[TEARDOWN];
    if (!allowed || !teardown) throw new Error("test/hermetic.ts is not preloaded");
    allowed.add(instance.localPort);
    teardown.push(async () => {
        const closed = new Promise<void>((resolve) => instance.server.once("close", () => resolve()));
        instance.stop();
        await within("the test daemon to close", closed);
        allowed.delete(instance.localPort);
    });
    return { port: instance.localPort, dataDir, panelToken: (panelId) => instance.auth.issuePanelToken(panelId) };
}
