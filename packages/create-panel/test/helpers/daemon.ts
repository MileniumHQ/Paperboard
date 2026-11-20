// The real Paperboard daemon (packages/testkit/src/craneBinary.ts): the crane compiled
// from this checkout, in its own process, on a free loopback port, over the
// throwaway PAPERBOARD_DIR the preload set. Panel services of the panels
// linked into that folder start with it, and PaperAPI in this process finds
// it through that folder's crane.json.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blocksApi, closeTransport, getTransport, STATE_VALUE } from "@mileniumhq/paperapi";
import { buildCrane, startCrane, type Crane } from "testkit/craneBinary";

const SERVICE_DEADLINE_MS = 30_000;

export interface Daemon {
    port: number;
    // resolves once the panel's service answers for its state
    serviceRegistered(panelId: string): Promise<void>;
    stop(): Promise<void>;
}

export async function startDaemon(): Promise<Daemon> {
    const dataDir = process.env.PAPERBOARD_DIR;
    if (!dataDir) throw new Error("PAPERBOARD_DIR is not set: the create-panel preload (test/setup.ts) did not run");
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-panel-crane-"));
    let crane: Crane;
    try {
        crane = await startCrane(buildCrane(binDir), dataDir);
    } catch (err) {
        fs.rmSync(binDir, { recursive: true, force: true });
        throw err;
    }
    return {
        port: crane.port,
        // the SDK, as the host, over the handshake the daemon wrote: a
        // registry update is the signal, the service's state value answering
        // is the proof
        serviceRegistered: (panelId) =>
            new Promise<void>((resolve, reject) => {
                let done = false;
                let lastError = "it registered nothing";
                const transport = getTransport();
                const finish = (err?: Error) => {
                    if (done) return;
                    done = true;
                    clearTimeout(deadline);
                    unsubscribe();
                    if (err) reject(err);
                    else resolve();
                };
                const check = () =>
                    void blocksApi.read(panelId, STATE_VALUE).then(
                        () => finish(),
                        (err: Error) => {
                            lastError = err.message;
                        },
                    );
                const deadline = setTimeout(() => finish(new Error(`${panelId}'s service did not answer within ${SERVICE_DEADLINE_MS} ms: ${lastError}`)), SERVICE_DEADLINE_MS);
                const unsubscribe = transport.subscribeEvent("blocks:registry-updated", check);
                check();
            }),
        stop: async () => {
            closeTransport();
            try {
                await crane.stop();
            } finally {
                fs.rmSync(binDir, { recursive: true, force: true });
            }
        },
    };
}
