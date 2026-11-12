// Stopping a supervised process is observed, never inferred: a kill is
// done when the exit event arrives, and a process that outlives SIGKILL is
// an error, not a success.

import { appendTail } from "../core/ollamaLog";

/** The exit side of the process surface agents need. */
export interface ExitHost {
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onExit(id: string, cb: (code?: number) => void): () => void;
}

export interface ExitWatch {
    exited: Promise<number | undefined>;
    off: () => void;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves on the process's next exit (subscribe before starting or killing it). */
export function watchExit(host: ExitHost, procId: string): ExitWatch {
    let off: () => void = () => {};
    const exited = new Promise<number | undefined>((resolve) => {
        off = host.onExit(procId, (code) => resolve(code));
    });
    return { exited, off: () => off() };
}

/** SIGTERM, then SIGKILL, each waited out until the exit is seen. */
export async function killObserved(host: ExitHost, procId: string, watch: ExitWatch, timeoutMs: number, label: string): Promise<void> {
    try {
        await host.kill(procId, "SIGTERM");
        if (await Promise.race([watch.exited.then(() => true), delay(timeoutMs).then(() => false)])) return;
        await host.kill(procId, "SIGKILL");
        if (await Promise.race([watch.exited.then(() => true), delay(timeoutMs).then(() => false)])) return;
        if (await host.exists(procId)) throw new Error(`${label} did not exit after SIGKILL.`);
    } finally {
        watch.off();
    }
}

const STDERR_TAIL_LINES = 20;

/** The last lines a process printed to stderr, shown when it fails. */
export class StderrTail {
    private lines: string[] = [];
    private partial = "";

    push(data: string): void {
        const lines = (this.partial + data).split(/\r?\n/);
        this.partial = (lines.pop() ?? "").slice(-4096);
        this.lines = appendTail(this.lines, lines.map((l) => l.slice(0, 1000)), STDERR_TAIL_LINES);
    }

    clear(): void {
        this.lines = [];
        this.partial = "";
    }

    text(): string {
        return [...this.lines, this.partial].filter((l) => l.trim()).slice(-STDERR_TAIL_LINES).join("\n");
    }

    detail(): { errorDetail?: string } {
        const text = this.text();
        return text ? { errorDetail: text } : {};
    }
}
