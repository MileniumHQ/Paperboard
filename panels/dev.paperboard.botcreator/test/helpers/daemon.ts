// The real Paperboard daemon for the suite (packages/testkit/src/craneBinary.ts): the
// crane compiled from this checkout, in its own process, on a free loopback
// port, over the throwaway PAPERBOARD_DIR test/hermetic.ts made. paperapi in
// the test process finds it through that directory's crane.json and talks to
// it over the real wire as the host.
//
// Its own process, not the test's: Bun's WebSocket client and the daemon's
// server in one process now and then garble a frame (the client closes with
// 1002, WS_ERR_UNEXPECTED_RSV_2_3), which a person's daemon never shares a
// process with.
//
// One daemon per test process: bun runs every file of the suite in one
// process, and paperapi's transport is bound to the first daemon it finds.
// It stops when the suite ends (test/hermetic.ts).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTransport } from "@mileniumhq/paperapi";
import { buildCrane, startCrane } from "testkit/craneBinary";

const ALLOWED = Symbol.for("paperboard.botcreator.test.ports");
const TEARDOWN = Symbol.for("paperboard.botcreator.test.teardown");

export interface TestDaemon {
    port: number;
    dataDir: string;
    /** a scoped credential for one panel, as the daemon hands a panel service or window */
    panelToken(panelId: string): Promise<string>;
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
    const allowed: Set<number> = (globalThis as any)[ALLOWED];
    const teardown: (() => Promise<void>)[] = (globalThis as any)[TEARDOWN];
    if (!allowed || !teardown) throw new Error("test/hermetic.ts is not preloaded");
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "botcreator-crane-"));
    const crane = await startCrane(buildCrane(binDir), dataDir);
    allowed.add(crane.port);
    teardown.push(async () => {
        await crane.stop();
        allowed.delete(crane.port);
        fs.rmSync(binDir, { recursive: true, force: true });
    });
    return {
        port: crane.port,
        dataDir,
        async panelToken(panelId) {
            const granted = await getTransport().call("auth:panel-token", { panelId });
            return granted.token;
        },
    };
}
