// Bot Creator's service as the daemon boots it: its own process, running
// src/service.ts (or a stand-in under test/fixtures) with
// PAPERBOARD_PANEL_ID, a scoped panel token the daemon issued and the
// daemon's port, ready once it reports `paperboard:service-ready` over IPC.
// Its Discord is the test's loopback one (BOTCREATOR_DISCORD_API).
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { secretsApi, serviceApi } from "@mileniumhq/paperapi";
import { PANEL_ID, tokenName, type StoredBot } from "../../src/bots";
import { testDaemon } from "./daemon";
import { within } from "./wait";

export { PANEL_ID };
const SERVICE_ENTRY = path.resolve(import.meta.dir, "../../src/service.ts");
const READY_MS = 20_000;
const TEARDOWN = Symbol.for("paperboard.botcreator.test.teardown");

export interface ServiceProcess {
    /** everything the service printed */
    output(): string;
    /** SIGTERM, as the daemon stops a service */
    stop(): Promise<void>;
}

const running = new Set<ServiceProcess>();
let registered = false;

/** Stops every service still running (for afterEach). */
export async function stopServices(): Promise<void> {
    for (const service of [...running]) await service.stop();
}

/** Saves bots as the service keeps them, each token in the vault, for the next service to start with. */
export async function savedBots(bots: { stored: StoredBot; token?: string }[]): Promise<void> {
    if (running.size > 0) throw new Error("Stop the service before replacing its bots");
    const daemon = await testDaemon();
    const file = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 2, bots: bots.map((b) => b.stored) }));
    for (const { stored, token } of bots) {
        if (token) await secretsApi.set(tokenName(stored.id), token, PANEL_ID);
        else await secretsApi.delete(tokenName(stored.id), PANEL_ID);
    }
}

export function storedBot(id: string, appId: string, extra: Partial<StoredBot> = {}): StoredBot {
    return { id, name: `Bot ${id}`, avatar: "", applicationId: appId, enabled: true, commands: [], createdAt: Date.now(), ...extra };
}

/** Starts the service (or the stand-in at `entry`) against the test daemon and `discordApi`. */
export async function startService(options: { discordApi: string; entry?: string }): Promise<ServiceProcess> {
    const daemon = await testDaemon();
    if (!registered) {
        registered = true;
        (globalThis as any)[TEARDOWN].push(stopServices);
    }
    const env: Record<string, string | undefined> = {
        ...process.env,
        PAPERBOARD_DIR: daemon.dataDir,
        PAPERBOARD_PANEL_ID: PANEL_ID,
        PAPERCRANE_PANEL_TOKEN: daemon.panelToken(PANEL_ID),
        PAPERCRANE_PORT: String(daemon.port),
        BOTCREATOR_DISCORD_API: options.discordApi,
    };
    delete env.PAPERCRANE_TOKEN;
    const child: ChildProcess = spawn(process.execPath, [options.entry ?? SERVICE_ENTRY], { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let log = "";
    child.stdout!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    child.stderr!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const service: ServiceProcess = {
        output: () => log,
        async stop() {
            running.delete(service);
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
            await within("the Bot Creator service to exit", exited, READY_MS, () => log);
        },
    };
    running.add(service);
    const ready = new Promise<void>((resolve, reject) => {
        child.on("message", (message: any) => {
            if (message?.type === "paperboard:service-ready" && message.panelId === PANEL_ID) resolve();
        });
        void exited.then(() => reject(new Error(`The Bot Creator service exited before it was ready:\n${log}`)));
    });
    await within("the Bot Creator service to report ready", ready, READY_MS, () => log);
    return service;
}

/** One of the service's own calls, as the panel's page makes it. */
export function call<T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> {
    return serviceApi.call<T>(PANEL_ID, name, input);
}
