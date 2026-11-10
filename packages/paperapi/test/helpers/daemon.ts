// The real Paperboard daemon in this test process, as the desktop app embeds
// it (loopback, a port the OS picks, headless), on the throwaway
// PAPERBOARD_DIR the preload set, and panel services as real child
// processes booted the way the daemon boots them: PAPERBOARD_PANEL_ID,
// a scoped PAPERCRANE_PANEL_TOKEN and PAPERCRANE_PORT.
//
// The daemon is loaded by a path the typechecker does not follow: it is
// another target's source, typechecked by its own gate step.
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const DAEMON_ENTRY = join(import.meta.dir, "..", "..", "..", "..", "apps", "paperboard", "papercrane", "index.ts");
export const SERVICE_SCRIPT = join(import.meta.dir, "panelService.ts");
const READY_TIMEOUT_MS = 20_000;

interface ServerInstance {
    localPort: number;
    server: { once(event: "close", cb: () => void): void };
    auth: { issuePanelToken(panelId: string): string };
    stop(): void;
}

export interface Daemon {
    port: number;
    // starts a panel service from test/helpers/panelService.ts and resolves
    // once it reports its actions registered
    startPanel(panelId: string, scenario: string): Promise<PanelProcess>;
    stop(): Promise<void>;
}

export interface PanelProcess {
    panelId: string;
    stop(): Promise<void>;
}

export async function startDaemon(): Promise<Daemon> {
    if (!process.env.PAPERBOARD_DIR) throw new Error("PAPERBOARD_DIR is not set: the paperapi preload (test/setup.ts) did not run");
    const entry: string = DAEMON_ENTRY;
    const mod = (await import(entry)) as { startPaperCraneServer(options: Record<string, unknown>): Promise<ServerInstance> };
    const instance = await mod.startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    const children = new Set<ChildProcess>();
    return {
        port: instance.localPort,
        startPanel: (panelId, scenario) =>
            new Promise<PanelProcess>((resolve, reject) => {
                const env: Record<string, string | undefined> = {
                    ...process.env,
                    PAPERBOARD_PANEL_ID: panelId,
                    PAPERCRANE_PANEL_TOKEN: instance.auth.issuePanelToken(panelId),
                    PAPERCRANE_PORT: String(instance.localPort),
                    PANEL_SCENARIO: scenario,
                };
                delete env.PAPERCRANE_TOKEN;
                const child = spawn(process.execPath, [SERVICE_SCRIPT], { env, stdio: ["ignore", "pipe", "pipe"] });
                children.add(child);
                let out = "";
                let err = "";
                const exited = new Promise<void>((done) => child.once("exit", () => done()));
                const timer = setTimeout(() => reject(new Error(`${panelId} (${scenario}) did not report ready within ${READY_TIMEOUT_MS} ms\n${out}\n${err}`)), READY_TIMEOUT_MS);
                child.stderr!.on("data", (chunk: Buffer) => {
                    err += chunk.toString();
                });
                child.stdout!.on("data", (chunk: Buffer) => {
                    out += chunk.toString();
                    if (out.includes("READY\n")) {
                        clearTimeout(timer);
                        resolve({
                            panelId,
                            stop: async () => {
                                if (child.exitCode === null && child.signalCode === null) child.kill();
                                await exited;
                                children.delete(child);
                            },
                        });
                    }
                });
                child.once("exit", (code) => {
                    clearTimeout(timer);
                    reject(new Error(`${panelId} (${scenario}) exited ${code} before it was ready\n${out}\n${err}`));
                });
            }),
        stop: async () => {
            for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
            await new Promise<void>((resolve) => {
                instance.server.once("close", () => resolve());
                instance.stop();
            });
        },
    };
}
