// A headless Chrome driven over the DevTools protocol, for what jsdom
// cannot show: images that really load, decode and fail. A missing Chrome
// fails the suite with the reason; it is never skipped.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CANDIDATES = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const STARTUP_TIMEOUT_MS = 30_000;

function chromePath(): string {
    const configured = process.env.CHROME_PATH;
    if (configured) {
        if (!existsSync(configured)) throw new Error(`CHROME_PATH is ${configured}, which does not exist`);
        return configured;
    }
    const found = CANDIDATES.find((candidate) => existsSync(candidate));
    if (!found) throw new Error(`the library's browser tests need Google Chrome: none at ${CANDIDATES.join(", ")}. Install it or set CHROME_PATH.`);
    return found;
}

interface Message {
    id?: number;
    method?: string;
    result?: Record<string, unknown>;
    error?: { message: string };
    sessionId?: string;
}

export interface Tab {
    /** Evaluates an expression in the page, awaiting a returned promise, and returns its value. */
    evaluate<T>(expression: string): Promise<T>;
}

export interface Chrome {
    open(url: string): Promise<Tab>;
    close(): Promise<void>;
}

export async function launchChrome(): Promise<Chrome> {
    const profile = await mkdtemp(path.join(tmpdir(), "library-chrome-"));
    const child: ChildProcess = spawn(
        chromePath(),
        [
            "--headless=new",
            "--remote-debugging-port=0",
            `--user-data-dir=${profile}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-gpu",
            "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
    );
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

    const endpoint = await new Promise<string>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => reject(new Error(`Chrome did not open DevTools within ${STARTUP_TIMEOUT_MS} ms:\n${output}`)), STARTUP_TIMEOUT_MS);
        child.stderr!.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]!);
            }
        });
        child.once("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        void exited.then((code) => {
            clearTimeout(timer);
            reject(new Error(`Chrome exited (${code}) before DevTools opened:\n${output}`));
        });
    });

    const ws = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error(`could not connect to Chrome DevTools at ${endpoint}`)), { once: true });
    });
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; method: string }>();
    ws.addEventListener("message", (event) => {
        const msg = JSON.parse(String(event.data)) as Message;
        if (msg.id === undefined) return;
        const call = pending.get(msg.id);
        if (!call) return;
        pending.delete(msg.id);
        if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
        else call.resolve(msg.result ?? {});
    });
    ws.addEventListener("close", () => {
        for (const call of pending.values()) call.reject(new Error(`${call.method}: the DevTools connection closed`));
        pending.clear();
    });
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject, method });
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });

    return {
        async open(url) {
            const { targetId } = await send("Target.createTarget", { url: "about:blank" });
            const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
            await send("Page.enable", {}, sessionId);
            await send("Page.navigate", { url }, sessionId);
            const tab: Tab = {
                async evaluate<T>(expression: string) {
                    const result = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)) as {
                        result: { value?: T };
                        exceptionDetails?: { text: string; exception?: { description?: string } };
                    };
                    if (result.exceptionDetails) {
                        throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
                    }
                    return result.result.value as T;
                },
            };
            return tab;
        },
        async close() {
            // a clean shutdown: Chrome flushes and stops writing the profile
            // before it exits, so the profile can be removed after
            if (child.exitCode === null && child.signalCode === null) {
                await send("Browser.close").catch((err: Error) => {
                    if (!/connection closed/.test(err.message)) throw err;
                });
            }
            await exited;
            ws.close();
            await rm(profile, { recursive: true, force: true });
        },
    };
}
