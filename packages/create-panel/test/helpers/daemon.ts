// The real Paperboard daemon in this test process, as the desktop app
// embeds it: loopback, a port the OS picks, headless, on the throwaway
// PAPERBOARD_DIR the preload set. Panel services of the panels linked into
// that folder start with it.
import type * as DaemonModule from "../../../../apps/paperboard/papercrane/index";
import { actionsApi } from "../../../paperapi/src/actions";
import { closeTransport } from "../../../paperapi/src/ipc";

const DAEMON = new URL("../../../../apps/paperboard/papercrane/index.ts", import.meta.url).pathname;
const SERVICE_DEADLINE_MS = 30_000;

export interface Daemon {
    port: number;
    // resolves once the panel's service has registered its actions
    serviceRegistered(panelId: string): Promise<void>;
    stop(): Promise<void>;
}

export async function startDaemon(): Promise<Daemon> {
    if (!process.env.PAPERBOARD_DIR) throw new Error("PAPERBOARD_DIR is not set: the create-panel preload (test/setup.ts) did not run");
    const { startPaperCraneServer }: typeof DaemonModule = await import(DAEMON);
    const instance = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    return {
        port: instance.localPort,
        // the SDK, as the host, over the handshake the daemon wrote: the
        // registry-changed event is the signal, the action list the answer
        serviceRegistered: (panelId) =>
            new Promise<void>((resolve, reject) => {
                let done = false;
                const finish = (err?: Error) => {
                    if (done) return;
                    done = true;
                    clearTimeout(deadline);
                    off();
                    if (err) reject(err);
                    else resolve();
                };
                const check = () =>
                    actionsApi.list(panelId).then(
                        (actions) => {
                            if (actions.length > 0) finish();
                        },
                        (err: Error) => finish(err),
                    );
                const deadline = setTimeout(() => finish(new Error(`${panelId}'s service registered no actions within ${SERVICE_DEADLINE_MS} ms`)), SERVICE_DEADLINE_MS);
                const off = actionsApi.onRegistryChange(() => void check());
                void check();
            }),
        stop: () =>
            new Promise<void>((resolve) => {
                closeTransport();
                instance.server.once("close", () => resolve());
                instance.stop();
            }),
    };
}
