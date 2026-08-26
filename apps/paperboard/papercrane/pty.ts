import * as fs from "fs";
import * as cp from "child_process";
import * as os from "os";
import { IPtyProcess } from "./types";

let ffiLibc: any = null;
let ffiPtr: any = null;
const isDarwin = process.platform === "darwin";
const TIOCSWINSZ = isDarwin ? 0x80087467 : 0x5414;

// Load Bun FFI C library symbols for zero-dependency native pseudo-terminals
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
} catch {}

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

// Spawns a PTY using Bun FFI, node-pty, or child_process fallback
export function spawnPty(
    shell: string,
    cols: number,
    rows: number,
    cwd: string,
    env: Record<string, string>,
): IPtyProcess {
    // 1. Bun FFI native openpty (Linux / macOS)
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
            const primaryFd = primaryBuf[0];
            const secondaryFd = secondaryBuf[0];
            const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

            const proc = cp.spawn(shell, [], {
                stdio: [secondaryFd, secondaryFd, secondaryFd],
                cwd: safeCwd,
                env,
                detached: true,
            });

            try {
                ffiLibc.symbols.close(secondaryFd);
            } catch {}

            const inStream = fs.createReadStream("", { fd: primaryFd, autoClose: false });
            const outStream = fs.createWriteStream("", { fd: primaryFd, autoClose: false });
            inStream.on("error", () => {});
            outStream.on("error", () => {});

            let isCleanedUp = false;
            const cleanup = () => {
                if (isCleanedUp) return;
                isCleanedUp = true;
                try { inStream.destroy(); } catch {}
                try { outStream.destroy(); } catch {}
                try { ffiLibc.symbols.close(primaryFd); } catch {}
            };

            return {
                write(data: string) {
                    if (!isCleanedUp) try { outStream.write(data); } catch {}
                },
                resize(newCols: number, newRows: number) {
                    if (!isCleanedUp && newCols > 0 && newRows > 0) {
                        try {
                            const ws = new Uint16Array([newRows, newCols, 0, 0]);
                            ffiLibc.symbols.ioctl(primaryFd, TIOCSWINSZ, ffiPtr(ws));
                        } catch {}
                    }
                },
                onData(cb: (data: string) => void) {
                    inStream.on("data", (chunk: any) => {
                        try { cb(chunk.toString("utf8")); } catch {}
                    });
                },
                onExit(cb: (code: number) => void) {
                    proc.on("close", (code) => {
                        cleanup();
                        try { cb(code ?? 0); } catch {}
                    });
                    proc.on("error", () => {
                        cleanup();
                        try { cb(1); } catch {}
                    });
                },
                kill() {
                    try { proc.kill(); } catch {}
                    cleanup();
                },
            };
        }
    }

    // 2. node-pty fallback
    try {
        const nodePty = require("node-pty");
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
    } catch {}

    // 3. child_process basic pipe fallback
    const proc = cp.spawn(shell, process.platform === "win32" ? [] : ["-i"], { cwd, env });
    return {
        write: (d: string) => proc.stdin?.write(d),
        resize: () => {},
        onData: (cb: (d: string) => void) => {
            proc.stdout?.on("data", (chunk: any) => cb(chunk.toString("utf8")));
            proc.stderr?.on("data", (chunk: any) => cb(chunk.toString("utf8")));
        },
        onExit: (cb: (code: number) => void) =>
            proc.on("close", (code) => cb(code ?? 0)),
        kill: () => proc.kill(),
    };
}
