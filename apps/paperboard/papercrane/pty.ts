import * as fs from "fs";
import * as cp from "child_process";
import * as os from "os";
import * as path from "path";
import { IPtyProcess } from "./types";
import { logger } from "./logger";

let ffiLibc: any = null;
let ffiPtr: any = null;
const isDarwin = process.platform === "darwin";
const TIOCSWINSZ = isDarwin ? 0x80087467 : 0x5414;

// FFI symbols for native pseudo-terminals
try {
    const { dlopen, FFIType, ptr } = require("bun:ffi");
    ffiPtr = ptr;
    const libPath = isDarwin ? "libSystem.B.dylib" : "libc.so.6";
    ffiLibc = dlopen(libPath, {
        openpty: {
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.i32,
        },
        ioctl: {
            args: [FFIType.i32, FFIType.u64, FFIType.ptr],
            returns: FFIType.i32,
        },
        close: {
            args: [FFIType.i32],
            returns: FFIType.i32,
        },
    });
} catch (err) { logger.debug("[pty.ts] op failed:", err) }

// restore exec bit on native helpers, copies strip it
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
        } catch (err) { logger.debug("[pty.ts] op failed:", err) }
    } catch (err) { logger.debug("[pty.ts] op failed:", err) }
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

// native pty via FFI, then node-pty, then pipe fallback
export function spawnPty(
    shell: string,
    cols: number,
    rows: number,
    cwd: string,
    env: Record<string, string>,
): IPtyProcess {
    // Bun FFI native openpty
    if (ffiLibc && ffiPtr && process.platform !== "win32") {
        const primaryBuf = new Int32Array(1);
        const secondaryBuf = new Int32Array(1);
        const winSize = new Uint16Array([rows, cols, 0, 0]);

        const res = ffiLibc.symbols.openpty(
            ffiPtr(primaryBuf),
            ffiPtr(secondaryBuf),
            null,
            null,
            ffiPtr(winSize),
        );

        if (res === 0) {
            logger.debug(`[pty] using bun-ffi backend for ${shell}`);
            const primaryFd = primaryBuf[0];
            const secondaryFd = secondaryBuf[0];
            const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

            const proc = cp.spawn(shell, [], {
                stdio: [secondaryFd, secondaryFd, secondaryFd],
                cwd: safeCwd,
                env,
                detached: true,
                windowsHide: true,
            });

            try {
                ffiLibc.symbols.close(secondaryFd);
            } catch (err) { logger.debug("[pty.ts] op failed:", err) }

            const inStream = fs.createReadStream("", { fd: primaryFd, autoClose: false });
            const outStream = fs.createWriteStream("", { fd: primaryFd, autoClose: false });
            inStream.on("error", (err) => logger.debug("[pty.ts] fd pipe error:", err));
            outStream.on("error", (err) => logger.debug("[pty.ts] fd pipe error:", err));

            let isCleanedUp = false;
            const cleanup = () => {
                if (isCleanedUp) return;
                isCleanedUp = true;
                try { inStream.destroy(); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                try { outStream.destroy(); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                try { ffiLibc.symbols.close(primaryFd); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
            };

            return {
                write(data: string) {
                    if (!isCleanedUp) try { outStream.write(data); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                },
                resize(newCols: number, newRows: number) {
                    if (!isCleanedUp && newCols > 0 && newRows > 0) {
                        try {
                            const ws = new Uint16Array([newRows, newCols, 0, 0]);
                            ffiLibc.symbols.ioctl(primaryFd, TIOCSWINSZ, ffiPtr(ws));
                        } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                    }
                },
                onData(cb: (data: string) => void) {
                    inStream.on("data", (chunk: any) => {
                        try { cb(chunk.toString("utf8")); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                    });
                },
                onExit(cb: (code: number) => void) {
                    proc.on("close", (code) => {
                        cleanup();
                        try { cb(code ?? 0); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                    });
                    proc.on("error", () => {
                        cleanup();
                        try { cb(1); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                    });
                },
                kill() {
                    try { proc.kill(); } catch (err) { logger.debug("[pty.ts] op failed:", err) }
                    cleanup();
                },
            };
        } else {
            logger.warn(`[pty] bun-ffi openpty failed (rc=${res}), trying node-pty`);
        }
    }

// collect loadable node-pty copies, callers spawn-test each in turn
function loadNodePtyCandidates(): { label: string; mod: any }[] {
    const out: { label: string; mod: any }[] = [];
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require("node-pty");
        logger.debug(`[pty] node-pty resolved via bundled require`);
        out.push({ label: "bundled", mod });
    } catch (err: any) {
        logger.debug(`[pty] bundled node-pty unavailable (${err?.message ?? err}), trying sidecar…`);
    }
    try {
        const sidecar = path.join(
            path.dirname(process.execPath),
            "node-pty",
            "lib",
            "index.js",
        );
        if (!fs.existsSync(sidecar)) {
            logger.debug(`[pty] no node-pty sidecar at ${sidecar}`);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(sidecar);
            logger.debug(`[pty] node-pty resolved via sidecar ${sidecar}`);
            out.push({ label: `sidecar ${sidecar}`, mod });
        }
    } catch (err: any) {
        logger.warn(`[pty] node-pty sidecar unavailable:`, err?.message ?? err);
    }
    return out;
}
    // node-pty backends
    for (const { label, mod: nodePty } of loadNodePtyCandidates()) {
        try {
            logger.debug(`[pty] using node-pty backend (${label}) for ${shell}`);
            const term = nodePty.spawn(shell, [], {
                name: env.TERM || "xterm-256color",
                cols,
                rows,
                cwd,
                env,
            });

        return {
            write: (d: string) => term.write(d),
            resize: (c: number, r: number) => term.resize(c, r),
            onData: (cb: (d: string) => void) => term.onData(cb),
            onExit: (cb: (code: number) => void) =>
                term.onExit(({ exitCode }: { exitCode: number }) => cb(exitCode ?? 0)),
            kill: () => term.kill(),
        };
    } catch (err: any) {
        logger.warn(`[pty] node-pty (${label}) spawn failed, trying next backend for ${shell}:`, err?.message ?? err);
    }
    }

    // pipe fallback, no real pty
    logger.warn(`[pty] no pty backend available, shell ${shell} runs without a terminal`);
    const proc = cp.spawn(shell, process.platform === "win32" ? [] : ["-i"], { cwd, env, windowsHide: true });
    return {
        write: (d: string) => proc.stdin?.write(d),
        // no terminal to resize in the pipe fallback
        resize: () => {
            /* nothing to resize without a real pty */
        },
        onData: (cb: (d: string) => void) => {
            proc.stdout?.on("data", (chunk: any) => cb(chunk.toString("utf8")));
            proc.stderr?.on("data", (chunk: any) => cb(chunk.toString("utf8")));
        },
        onExit: (cb: (code: number) => void) =>
            proc.on("close", (code) => cb(code ?? 0)),
        kill: () => proc.kill(),
    };
}
