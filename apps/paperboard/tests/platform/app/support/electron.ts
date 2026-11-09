// Real Electron, launched the way AGENTS.md says: ELECTRON_RUN_AS_NODE
// removed, a throwaway PAPERBOARD_DIR and --user-data-dir, and windows kept
// hidden by support/harness.cjs, which also carries the test's commands.
import * as net from "node:net";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { APP_DIR } from "./build";
import { watch, WAIT_MS, type Watched } from "./crane";
import { ownChild, tempDir } from "./temp";

export function electronBinary(): string {
    // the electron package exports its binary's path; it throws when the
    // binary was never fetched, which is the failure's reason
    const binary = require(path.join(APP_DIR, "node_modules", "electron")) as unknown;
    if (typeof binary !== "string") throw new Error("the electron package did not name its binary");
    return binary;
}

export interface HarnessEvent {
    event: string;
    [key: string]: any;
}

export interface ElectronApp extends Watched {
    events: HarnessEvent[];
    userDataDir: string;
    // resolves with the first harness event matching `match`
    waitEvent(what: string, match: (e: HarnessEvent) => boolean, ms?: number): Promise<HarnessEvent>;
    // evaluates in the first page whose URL starts with `match`
    evalIn<T = any>(match: string, code: string): Promise<T>;
    evalInFrame<T = any>(match: string, code: string): Promise<T>;
    // runs `code` as an async function body in the main process
    evalMain<T = any>(code: string): Promise<T>;
    quit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    // what the main process and renderers reported as broken
    failures(): HarnessEvent[];
}

const HARNESS = path.join(import.meta.dir, "harness.cjs");

export async function launchElectron(options: {
    appDir: string;
    dataDir: string;
    args?: string[];
    env?: Record<string, string>;
    // the profile Electron opens; a fresh throwaway one by default
    userDataDir?: string;
}): Promise<ElectronApp> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    const userDataDir = options.userDataDir ?? tempDir("electron-profile");
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, PAPERBOARD_DIR: options.dataDir, PB_HARNESS_PORT: String(port) };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    delete env.PAPERCRANE_PORT;
    const child = spawn(electronBinary(), ["--require", HARNESS, options.appDir, `--user-data-dir=${userDataDir}`, ...(options.args ?? [])], {
        env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    ownChild(child);
    const watched = watch(child, "electron");
    const events: HarnessEvent[] = [];
    const waiters = new Set<() => void>();
    const replies = new Map<number, (reply: { result?: any; error?: string }) => void>();
    let link: net.Socket | null = null;
    const connected = new Promise<net.Socket>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`electron harness never connected:\n${watched.output()}`)), WAIT_MS);
        void watched.exited.then(() => {
            clearTimeout(timer);
            reject(new Error(`electron exited before its harness connected:\n${watched.output()}`));
        });
        server.once("connection", (socket) => {
            clearTimeout(timer);
            server.close();
            link = socket;
            let buffer = "";
            socket.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
                let newline: number;
                while ((newline = buffer.indexOf("\n")) >= 0) {
                    const message = JSON.parse(buffer.slice(0, newline));
                    buffer = buffer.slice(newline + 1);
                    if (typeof message.reply === "number") {
                        replies.get(message.reply)?.(message);
                        replies.delete(message.reply);
                    } else {
                        events.push(message);
                        for (const w of [...waiters]) w();
                    }
                }
            });
            resolve(socket);
        });
    });
    await connected;
    void watched.exited.then(() => {
        for (const settle of replies.values()) settle({ error: `electron exited:\n${watched.output()}` });
        replies.clear();
        for (const w of [...waiters]) w();
    });

    let nextId = 1;
    const command = <T>(op: string, fields: Record<string, unknown>, ms = WAIT_MS): Promise<T> => {
        const id = nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                replies.delete(id);
                reject(new Error(`electron: ${op} got no answer within ${ms} ms`));
            }, ms);
            replies.set(id, (reply) => {
                clearTimeout(timer);
                if (reply.error !== undefined) reject(new Error(reply.error));
                else resolve(reply.result as T);
            });
            link!.write(`${JSON.stringify({ id, op, ...fields })}\n`);
        });
    };

    return {
        ...watched,
        events,
        userDataDir,
        waitEvent(what, match, ms = WAIT_MS) {
            return new Promise((resolve, reject) => {
                const test = () => {
                    const found = events.find(match);
                    if (found) {
                        clearTimeout(timer);
                        waiters.delete(test);
                        resolve(found);
                    } else if (child.exitCode !== null || child.signalCode !== null) {
                        clearTimeout(timer);
                        waiters.delete(test);
                        reject(new Error(`electron exited before ${what}:\n${watched.output()}`));
                    }
                };
                const timer = setTimeout(() => {
                    waiters.delete(test);
                    reject(new Error(`electron: no ${what} within ${ms} ms; events: ${JSON.stringify(events).slice(0, 4000)}\n${watched.output()}`));
                }, ms);
                waiters.add(test);
                test();
            });
        },
        evalIn: (match, code) => command("eval", { match, code }),
        evalInFrame: (match, code) => command("evalFrame", { match, code }),
        evalMain: (code) => command("main", { code }),
        async quit() {
            if (child.exitCode === null && child.signalCode === null) await command("quit", {});
            return watched.exited;
        },
        failures: () => events.filter((e) =>
            e.event === "main-error" || e.event === "renderer-gone" || e.event === "preload-error" ||
            (e.event === "load-failed" && e.isMainFrame) || (e.event === "console" && e.level === "error")),
    };
}

// Resolves inside a page with the value of `expression` once it is truthy,
// watching the DOM rather than polling a clock.
export function domCondition(expression: string, ms = WAIT_MS): string {
    return `new Promise((resolve, reject) => {
        const check = () => (${expression});
        const first = check();
        if (first) return resolve(first);
        const observer = new MutationObserver(() => { const value = check(); if (value) { observer.disconnect(); clearTimeout(timer); resolve(value); } });
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error("timed out waiting for " + ${JSON.stringify(expression)} + "; page: " + document.body?.innerText?.slice(0, 2000))); }, ${ms});
    })`;
}

export const SHELL = "paperboard://shell/";

// The shell is up when its page loaded from the packaged origin and it has
// listed this computer from what the daemon answered.
export async function shellReady(electron: ElectronApp): Promise<void> {
    await electron.waitEvent("shell page", (e) => e.event === "loaded" && e.url === `${SHELL}index.html`);
    await electron.evalIn(SHELL, domCondition(`document.body.innerText.includes("This Computer")`));
}
