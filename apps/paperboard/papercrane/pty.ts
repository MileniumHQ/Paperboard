// PTY backends: exactly one per runtime, chosen by the runtime itself.
//
//   Bun (standalone Paperboard Server, i.e. the crane) -> Bun.Terminal
//   Node / Electron (the desktop app)                  -> node-pty
//
// Bun.Terminal is POSIX-only, so a Bun runtime on Windows takes the node-pty
// path just like Node does. There is no fallback chain: if the selected
// backend cannot start, spawnPty throws. A shell on pipes is not a terminal,
// so substituting one silently would be a lie.
import * as fs from "fs";
import * as path from "path";
import { IPtyProcess } from "./types";
import { logger } from "./logger";

const BunRuntime = (globalThis as { Bun?: any }).Bun;

// restore exec bit on node-pty's macOS spawn-helper, copies strip it
export function ensureNativeHelpersExecutable(): void {
    if (process.platform === "win32") return;
    try {
        const req =
            typeof require !== "undefined"
                ? require
                : (globalThis as any).require;
        if (typeof req?.resolve !== "function") return;
        const pkgJson = req.resolve("node-pty/package.json");
        const helper = path.join(
            path.dirname(pkgJson),
            `prebuilds/${process.platform}-${process.arch}`,
            "spawn-helper",
        );
        try {
            const st = fs.statSync(helper);
            if (!(st.mode & 0o111)) {
                fs.chmodSync(helper, st.mode | 0o755);
                logger.info(`[pty] restored executable bit on ${helper} (stripped by copy)`);
            }
        } catch (err) { logger.debug("[pty.ts] spawn-helper not present:", err) }
    } catch (err) { logger.debug("[pty.ts] node-pty not resolvable:", err) }
}

// Resolves default system shell per platform
export function getDefaultShell(): string {
    if (process.platform === "win32") {
        return process.env.COMSPEC || "powershell.exe";
    }
    if (process.platform === "darwin") {
        if (fs.existsSync("/bin/zsh")) return "/bin/zsh";
        if (fs.existsSync("/bin/bash")) return "/bin/bash";
        return "/bin/sh";
    }
    if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
        return process.env.SHELL;
    }
    if (fs.existsSync("/bin/bash")) return "/bin/bash";
    if (fs.existsSync("/usr/bin/bash")) return "/usr/bin/bash";
    return "/bin/sh";
}

export function spawnPty(
    shell: string,
    cols: number,
    rows: number,
    cwd: string,
    env: Record<string, string>,
    args: string[] = [],
): IPtyProcess {
    if (BunRuntime && process.platform !== "win32") {
        return spawnBunPty(shell, args, cols, rows, cwd, env);
    }
    return spawnNodePty(shell, args, cols, rows, cwd, env);
}

// Bun.Terminal hands data to one constructor callback, so early output is
// buffered until onData subscribes and flushed in order.
function spawnBunPty(
    shell: string,
    args: string[],
    cols: number,
    rows: number,
    cwd: string,
    env: Record<string, string>,
): IPtyProcess {
    const decoder = new TextDecoder();
    let onData: ((data: string) => void) | null = null;
    const buffered: string[] = [];

    const terminal = new BunRuntime.Terminal({
        cols,
        rows,
        name: env.TERM || "xterm-256color",
        data: (_term: unknown, data: Uint8Array) => {
            const text = decoder.decode(data, { stream: true });
            if (!text) return;
            if (onData) onData(text);
            else buffered.push(text);
        },
    });
    const proc = BunRuntime.spawn([shell, ...args], { terminal, cwd, env });

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        try { terminal.close(); } catch (err) { logger.debug("[pty] terminal close failed:", err) }
    };

    return {
        pid: proc.pid,
        write(data: string) {
            if (!closed) terminal.write(data);
        },
        resize(newCols: number, newRows: number) {
            if (!closed && newCols > 0 && newRows > 0) terminal.resize(newCols, newRows);
        },
        onData(callback: (data: string) => void) {
            onData = callback;
            for (const text of buffered.splice(0)) callback(text);
        },
        onExit(callback: (code: number) => void) {
            proc.exited
                .then((code: number) => callback(code ?? 0))
                .catch((err: unknown) => {
                    logger.debug("[pty] process exit wait failed:", err);
                    callback(1);
                })
                .finally(close);
        },
        kill() {
            try { proc.kill(); } catch (err) { logger.debug("[pty] kill failed:", err) }
            close();
        },
    };
}

function spawnNodePty(
    shell: string,
    args: string[],
    cols: number,
    rows: number,
    cwd: string,
    env: Record<string, string>,
): IPtyProcess {
    const nodePty = loadNodePty();
    const term = nodePty.spawn(shell, args, {
        name: env.TERM || "xterm-256color",
        cols,
        rows,
        cwd,
        env,
    });
    return {
        pid: term.pid,
        write: (data: string) => term.write(data),
        resize: (newCols: number, newRows: number) => term.resize(newCols, newRows),
        onData: (callback: (data: string) => void) => term.onData(callback),
        onExit: (callback: (code: number) => void) =>
            term.onExit(({ exitCode }: { exitCode: number }) =>
                callback(exitCode ?? 0),
            ),
        kill: () => term.kill(),
    };
}

// Which node-pty a runtime loads. Bun on Windows (the compiled crane) must
// use the sidecar publish.ts places beside the executable: the compiler
// bundles node-pty's JS, so `require("node-pty")` succeeds, but its native
// conpty.node is then resolved inside the virtual bundle and the first spawn
// fails. The sidecar also carries the conpty input-pipe patch Bun needs.
// Node and Electron load their own installed node-pty.
export function nodePtyEntry(
    runtime: { bun: boolean; platform: NodeJS.Platform; execPath: string },
    exists: (file: string) => boolean = fs.existsSync,
): string {
    if (!runtime.bun || runtime.platform !== "win32") return "node-pty";
    const sidecar = path.win32.join(path.win32.dirname(runtime.execPath), "node-pty", "lib", "index.js");
    if (!exists(sidecar)) {
        throw new Error(
            `Terminals need the node-pty folder that ships beside ${path.win32.basename(runtime.execPath)}; ` +
                `it is missing (${sidecar}). Copy the whole crane folder, not just the executable`,
        );
    }
    return sidecar;
}

function loadNodePty(): any {
    const entry = nodePtyEntry({
        bun: Boolean(BunRuntime),
        platform: process.platform,
        execPath: process.execPath,
    });
    if (entry !== "node-pty") logger.debug(`[pty] node-pty resolved via sidecar ${entry}`);
    return require(entry);
}
