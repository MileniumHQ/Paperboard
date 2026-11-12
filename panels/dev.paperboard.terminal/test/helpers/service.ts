// The Terminal panel's service as the daemon boots it: its own process,
// running src/service.ts with PAPERBOARD_PANEL_ID, a scoped panel token the
// daemon issued and the daemon's port, ready once it reports
// `paperboard:service-ready` over IPC. Stopping it sends SIGTERM, as the
// daemon does; crashing it sends SIGKILL.
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { blocksApi, getTransport, serviceApi, STATE_VALUE } from "@mileniumhq/paperapi";
import { testDaemon } from "./crane";
import { within } from "./wait";

export const PANEL_ID = "dev.paperboard.terminal";
const SERVICE_ENTRY = path.resolve(import.meta.dir, "../../src/service.ts");
const READY_MS = 20_000;

export interface ServiceProcess {
    /** everything the service printed */
    output(): string;
    /** SIGTERM, as the daemon stops a service; resolves with the exit */
    stop(): Promise<void>;
    /** SIGKILL: the service dies without running its handlers */
    crash(): Promise<void>;
}

const running = new Set<ServiceProcess>();
const TEARDOWN = Symbol.for("paperboard.terminal.test.teardown");
let tornDown = false;

/** Stops every service still running (for afterEach / afterAll). */
export async function stopServices(): Promise<void> {
    for (const service of [...running]) await service.stop();
}

/**
 * The panel's own folder in the daemon's data directory (tabs.json,
 * saved-commands.json, scrollback), emptied and refilled with `files`.
 * Only while no service runs: the next one starts from these.
 */
export async function panelFiles(files: Record<string, unknown> = {}): Promise<string> {
    if (running.size > 0) throw new Error("Stop the terminal service before replacing its files");
    const daemon = await testDaemon();
    const dir = path.join(daemon.dataDir, "files", PANEL_ID);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
    }
    return dir;
}

export async function startService(): Promise<ServiceProcess> {
    const daemon = await testDaemon();
    if (!tornDown) {
        tornDown = true;
        (globalThis as any)[TEARDOWN].push(stopServices);
    }
    const granted = (await getTransport().call("auth:panel-token", { panelId: PANEL_ID })) as { token: string };
    const env: Record<string, string | undefined> = {
        ...process.env,
        PAPERBOARD_DIR: daemon.dataDir,
        PAPERBOARD_PANEL_ID: PANEL_ID,
        PAPERCRANE_PANEL_TOKEN: granted.token,
        PAPERCRANE_PORT: String(daemon.port),
    };
    delete env.PAPERCRANE_TOKEN;
    const child: ChildProcess = spawn(process.execPath, [SERVICE_ENTRY], { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let log = "";
    child.stdout!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    child.stderr!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const end = async (signal: NodeJS.Signals) => {
        running.delete(service);
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        await within(`the terminal service to exit after ${signal}`, exited, READY_MS, () => log);
    };
    const service: ServiceProcess = {
        output: () => log,
        stop: () => end("SIGTERM"),
        crash: () => end("SIGKILL"),
    };
    running.add(service);
    const ready = new Promise<void>((resolve, reject) => {
        child.on("message", (message: any) => {
            if (message?.type === "paperboard:service-ready" && message.panelId === PANEL_ID) resolve();
        });
        void exited.then(() => reject(new Error(`The terminal service exited before it was ready:\n${log}`)));
    });
    await within("the terminal service to report ready", ready, READY_MS, () => log);
    return service;
}

/** The service's state, as a panel window hydrates it. */
export function serviceState<T = any>(): Promise<T> {
    return blocksApi.read<T>(PANEL_ID, STATE_VALUE);
}

/** One of the calls the panel's own page makes. */
export function call<T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> {
    return serviceApi.call<T>(PANEL_ID, name, input);
}

/** A command block, as a person's flow runs it. */
export function runBlock<T = any>(command: string, inputs: Record<string, unknown> = {}): Promise<T> {
    return blocksApi.run<T>(PANEL_ID, command, inputs);
}

/** A value block, as a person's flow reads it. */
export function readBlock<T = any>(value: string, inputs: Record<string, unknown> = {}): Promise<T> {
    return blocksApi.read<T>(PANEL_ID, value, inputs);
}
