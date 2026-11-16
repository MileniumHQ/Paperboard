// A real Paperboard daemon for a page test (test/helpers/daemon.main.ts, in a
// process of its own, on a throwaway data directory under the
// PAPERBOARD_DIR test/hermetic.ts made), with the Blocks service
// (src/service.ts) on it in a process of its own, as the daemon starts it.
// Other panels are real processes too (test/helpers/otherPanel.ts): one
// offers its blocks to the registry under its own panel token, as any
// panel's service does, and one is another Blocks window making the
// service's calls. Nothing here reaches the network: every process the
// suite starts has its proxies pointed at a port nothing listens on.
//
// The service reaches the daemon through a relay in this process, which
// passes every frame as it is, until the test has it refuse some: the
// registry away, as the service meets it (refuse()).
//
// A daemon per page, so pages that each need their own Blocks service run
// side by side.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectMeta, SavedFlows } from "../../src/panel";
import { PANEL_ID } from "../../src/panel";
import { PROJECTS_FILE, PROJECTS_VERSION, projectFlowsPath } from "../../src/lib/projects";

const PANEL = path.resolve(import.meta.dir, "../..");
const DAEMON_ENTRY = path.join(import.meta.dir, "daemon.main.ts");
const SERVICE_ENTRY = path.join(PANEL, "src/service.ts");
const OTHER_PANEL_ENTRY = path.join(import.meta.dir, "otherPanel.ts");
const WAIT_MS = 20_000;

function within<T>(what: string, promise: Promise<T>, context?: () => string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${WAIT_MS} ms waiting for ${what}${context ? `\n${context()}` : ""}`)), WAIT_MS);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const nowhere = "http://127.0.0.1:9";
/** the environment of a process the suite starts: its data directory, and no proxy that leads anywhere */
const offline = (dataDir: string): Record<string, string | undefined> => ({
    ...process.env,
    PAPERBOARD_DIR: dataDir,
    HTTP_PROXY: nowhere,
    HTTPS_PROXY: nowhere,
    ALL_PROXY: nowhere,
    http_proxy: nowhere,
    https_proxy: nowhere,
    all_proxy: nowhere,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
});

export interface TestDaemon {
    port: number;
    dataDir: string;
    /** a panel token the daemon issued, as it hands one to a panel's page or service */
    token(panelId: string): Promise<string>;
    /** stops the daemon and removes its data directory */
    stop(): Promise<void>;
}

/** Starts a daemon on a data directory of its own. */
export async function startDaemon(): Promise<TestDaemon> {
    const home = process.env.PAPERBOARD_DIR;
    if (!home || !home.startsWith(os.tmpdir())) throw new Error(`PAPERBOARD_DIR must be the throwaway dir test/hermetic.ts made, not ${home}`);
    const dataDir = fs.mkdtempSync(path.join(home, "daemon-"));
    const env = offline(dataDir);
    delete env.PAPERCRANE_TOKEN;
    const child = spawn(process.execPath, [DAEMON_ENTRY], { cwd: PANEL, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let log = "";
    child.stdout!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    child.stderr!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const tokens = new Map<number, (token: string) => void>();
    let asked = 0;
    const port = await within(
        "the test daemon to listen",
        new Promise<number>((resolve, reject) => {
            child.on("message", (message: any) => {
                if (message?.type === "listening") resolve(message.port);
                if (message?.type === "token") tokens.get(message.id)?.(message.token);
            });
            void exited.then(() => reject(new Error(`The test daemon exited before it listened:\n${log}`)));
        }),
        () => log,
    );
    return {
        port,
        dataDir,
        token(panelId) {
            const id = ++asked;
            const issued = new Promise<string>((resolve) => tokens.set(id, resolve));
            child.send({ type: "token", id, panelId });
            return within(`a panel token for ${panelId}`, issued, () => log);
        },
        async stop() {
            if (child.exitCode === null && child.signalCode === null) child.send({ type: "stop" });
            await within("the test daemon to stop", exited, () => log);
            fs.rmSync(dataDir, { recursive: true, force: true });
        },
    };
}

/** A process of the suite's on the daemon, and how to stop it. */
interface Started {
    child: ChildProcess;
    output(): string;
    stop(): Promise<void>;
}

async function startProcess(d: TestDaemon, panelId: string, args: string[], what: string, port = d.port): Promise<Started> {
    const env: Record<string, string | undefined> = { ...offline(d.dataDir), PAPERBOARD_PANEL_ID: panelId, PAPERCRANE_PANEL_TOKEN: await d.token(panelId), PAPERCRANE_PORT: String(port) };
    delete env.PAPERCRANE_TOKEN;
    const child = spawn(process.execPath, args, { cwd: PANEL, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let log = "";
    child.stdout!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    child.stderr!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const ready = new Promise<void>((resolve, reject) => {
        child.on("message", (message: any) => {
            if (message?.type === "paperboard:service-ready" && message.panelId === panelId) resolve();
        });
        void exited.then(() => reject(new Error(`${what} exited before it was ready:\n${log}`)));
    });
    await within(`${what} to report ready`, ready, () => log);
    return {
        child,
        output: () => log,
        async stop() {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
            await within(`${what} to exit`, exited, () => log);
        },
    };
}

/** What the Blocks service starts with: its projects, and the flows of any of them. */
export interface Seed {
    projects: ProjectMeta[];
    flows?: Record<string, SavedFlows>;
    /** the project list is no JSON, so the service can't read its projects as it starts */
    unreadable?: boolean;
    /** Blocks' backups go to this computer's own location, so Load backup lists them at once */
    backupsHere?: boolean;
}

/** What the relay refuses: the frames the service sends that `match` takes, answered with `error`. */
export interface Refusal {
    match: (frame: { action?: string; params?: Record<string, any> }) => boolean;
    error: string;
}

const HOP_BY_HOP = new Set(["host", "connection", "upgrade", "content-length"]);
const allowedPorts: Set<number> = (globalThis as any)[Symbol.for("paperboard.blocks.test.ports")];

interface Leg {
    path: string;
    headers: Record<string, string>;
    up?: WebSocket;
    waiting: string[];
}

/** A socket relay to the daemon, for the service: it passes every frame both ways, and answers the refused ones itself. */
function relay(daemonPort: number) {
    let refusal: Refusal | null = null;
    allowedPorts.add(daemonPort);
    const server = Bun.serve<Leg>({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, srv) {
            const url = new URL(req.url);
            const headers: Record<string, string> = {};
            for (const [name, value] of req.headers) if (!HOP_BY_HOP.has(name) && !name.startsWith("sec-websocket-")) headers[name] = value;
            if (srv.upgrade(req, { data: { path: url.pathname + url.search, headers, waiting: [] } })) return undefined;
            return new Response("the relay carries sockets only", { status: 400 });
        },
        websocket: {
            open(ws) {
                const up = new WebSocket(`ws://127.0.0.1:${daemonPort}${ws.data.path}`, { headers: ws.data.headers } as never);
                ws.data.up = up;
                up.addEventListener("open", () => {
                    for (const text of ws.data.waiting.splice(0)) up.send(text);
                });
                up.addEventListener("message", (event) => ws.send(String(event.data)));
                up.addEventListener("close", () => ws.close());
            },
            message(ws, message) {
                const text = String(message);
                const frame = text.startsWith("{") ? (JSON.parse(text) as { id?: unknown; action?: string; params?: Record<string, any> }) : null;
                if (frame && refusal?.match(frame)) return void ws.send(JSON.stringify({ type: "response", id: frame.id, error: refusal.error }));
                const up = ws.data.up!;
                if (up.readyState === WebSocket.OPEN) up.send(text);
                else ws.data.waiting.push(text);
            },
            close(ws) {
                ws.data.up?.close();
            },
        },
    });
    return {
        port: server.port!,
        refuse: (next: Refusal | null) => void (refusal = next),
        stop: () => server.stop(true),
    };
}

export interface BlocksService {
    /** the Blocks panel's files in the daemon's data directory (its storage) */
    storage: string;
    /** from now on the relay answers the service's frames that `refusal` matches with its error; null passes all again */
    refuse(refusal: Refusal | null): void;
    output(): string;
    /** stops the service and removes what it kept */
    stop(): Promise<void>;
}

/** Starts the Blocks service on daemon `d` over `seed`, written where it keeps its projects. */
export async function startBlocksService(d: TestDaemon, seed: Seed): Promise<BlocksService> {
    const storage = path.join(d.dataDir, "files", PANEL_ID);
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(path.join(d.dataDir, "configs", `${PANEL_ID}.json`), { force: true });
    const write = (rel: string, value: unknown) => {
        const file = path.join(storage, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value));
    };
    write(PROJECTS_FILE, { version: PROJECTS_VERSION, projects: seed.projects });
    if (seed.unreadable) fs.writeFileSync(path.join(storage, PROJECTS_FILE), "{ not json");
    for (const [id, flows] of Object.entries(seed.flows ?? {})) write(projectFlowsPath(id), flows);
    if (seed.backupsHere) {
        // the daemon's own list of backup locations: this computer's, for Blocks
        fs.mkdirSync(path.join(d.dataDir, "backups"), { recursive: true });
        fs.writeFileSync(path.join(d.dataDir, "backups", "destinations.json"), JSON.stringify({ version: 1, destinations: [], panels: { [PANEL_ID]: "local" } }));
    }
    const line = relay(d.port);
    const service = await startProcess(d, PANEL_ID, [SERVICE_ENTRY], "the Blocks service", line.port);
    return {
        storage,
        refuse: line.refuse,
        output: service.output,
        async stop() {
            await service.stop();
            line.stop();
            fs.rmSync(storage, { recursive: true, force: true });
        },
    };
}

/** Another panel on the daemon (test/helpers/otherPanel.ts), told what to do over IPC. */
export interface OtherPanel {
    /** what it was asked to do, and what came of it; a refusal rejects with why */
    ask<T = unknown>(request: Record<string, unknown>): Promise<T>;
    output(): string;
    stop(): Promise<void>;
}

let asked = 0;
/**
 * Starts test/helpers/otherPanel.ts on daemon `d` as panel `panelId`, installed on it under `name` so the panel list names it, doing `role` (see that file).
 */
export async function startOtherPanel(d: TestDaemon, panelId: string, name: string, role: string): Promise<OtherPanel> {
    const folder = path.join(d.dataDir, "panels", panelId);
    if (panelId !== PANEL_ID) {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ id: panelId, name, version: "1.0.0", description: "A panel of the Blocks tests", publisher: "Paperboard", base: "./index.html" }));
    }
    const started = await startProcess(d, panelId, [OTHER_PANEL_ENTRY, role], name);
    const answers = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    started.child.on("message", (message: any) => {
        if (message?.type !== "answer") return;
        const waiting = answers.get(message.id);
        answers.delete(message.id);
        if (message.error) waiting?.reject(new Error(message.error));
        else waiting?.resolve(message.result);
    });
    return {
        ask(request) {
            const id = ++asked;
            const answer = new Promise<any>((resolve, reject) => answers.set(id, { resolve, reject }));
            started.child.send({ type: "ask", id, request });
            return within(`${name} to answer ${JSON.stringify(request).slice(0, 120)}`, answer, started.output);
        },
        output: started.output,
        async stop() {
            await started.stop();
            if (panelId !== PANEL_ID) fs.rmSync(folder, { recursive: true, force: true });
        },
    };
}
