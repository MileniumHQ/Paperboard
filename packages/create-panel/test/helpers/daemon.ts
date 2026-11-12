// The real Paperboard daemon in this test process, as the desktop app
// embeds it: loopback, a port the OS picks, headless, on the throwaway
// PAPERBOARD_DIR the preload set. Panel services of the panels linked into
// that folder start with it.
import type * as DaemonModule from "../../../../apps/paperboard/papercrane/index";
import { blocksApi } from "../../../paperapi/src/blocks";
import { closeTransport, getTransport } from "../../../paperapi/src/ipc";
import { STATE_VALUE } from "../../../paperapi/src/serviceCalls";

const DAEMON = new URL("../../../../apps/paperboard/papercrane/index.ts", import.meta.url).pathname;
const SERVICE_DEADLINE_MS = 30_000;

export interface Daemon {
    port: number;
    // resolves once the panel's service answers for its state
    serviceRegistered(panelId: string): Promise<void>;
    stop(): Promise<void>;
}

export async function startDaemon(): Promise<Daemon> {
    if (!process.env.PAPERBOARD_DIR) throw new Error("PAPERBOARD_DIR is not set: the create-panel preload (test/setup.ts) did not run");
    const { startPaperCraneServer }: typeof DaemonModule = await import(DAEMON);
    const instance = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    return {
        port: instance.localPort,
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
                    transport.unsubscribeEvent("blocks:registry-updated", check);
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
                transport.subscribeEvent("blocks:registry-updated", check);
                check();
            }),
        stop: () =>
            new Promise<void>((resolve) => {
                closeTransport();
                instance.server.once("close", () => resolve());
                instance.stop();
            }),
    };
}
