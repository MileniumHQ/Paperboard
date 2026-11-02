import * as os from "os";

/**
 * The exit code a workload's observers see. A child ended by a signal has no
 * exit code (Node reports null); reporting 0 would read as clean success, so
 * it is the shell convention 128 + signal number instead.
 */
export function workloadExitCode(code: number | null, signal: NodeJS.Signals | null): number {
    if (code !== null) return code;
    const number = signal ? os.constants.signals[signal] : undefined;
    return number ? 128 + number : 1;
}

// Bun on Windows reports a child's exit code truncated to its low 8 bits: a
// crash with 0xC0000005 reads as 5, and a program that exits 256 reads as 0,
// a clean exit. Windows keeps the whole 32-bit code, which a crashed game
// (Unreal, .NET, a Source engine) ends with, so under Bun it is read back
// from the process itself. Node (the desktop app's supervisors) is exact.
interface Kernel32 {
    symbols: {
        OpenProcess(access: number, inherit: number, pid: number): unknown;
        GetExitCodeProcess(handle: unknown, out: Uint32Array): number;
        CloseHandle(handle: unknown): number;
        ExitProcess(code: number): void;
    };
}
let kernel32: Kernel32 | null = null;

function openKernel32(): Kernel32 {
    // bun:ffi only exists under Bun, so no bundler may try to resolve it
    const specifier = "bun:ffi";
    const { dlopen, FFIType } = require(specifier);
    return dlopen("kernel32.dll", {
        OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
        GetExitCodeProcess: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
        ExitProcess: { args: [FFIType.u32], returns: FFIType.void },
    });
}

const bunOnWindows = (): boolean => process.platform === "win32" && Boolean(process.versions.bun);
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

/**
 * The whole exit code of the Windows process `pid`, which must have just
 * exited: Bun still holds its handle until the exit has been reported.
 * `reported` is what Bun said; the real code must agree with it in the low
 * 8 bits, or the pid is not the process Bun was talking about.
 */
export function exactExitCode(pid: number, reported: number): number {
    if (!bunOnWindows()) return reported;
    const api = (kernel32 ??= openKernel32()).symbols;
    const handle = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!handle) throw new Error(`OpenProcess for pid ${pid} failed`);
    try {
        const out = new Uint32Array(1);
        if (!api.GetExitCodeProcess(handle, out)) throw new Error(`GetExitCodeProcess for pid ${pid} failed`);
        const exact = out[0]!;
        if ((exact & 0xff) !== reported) throw new Error(`pid ${pid} ended with ${exact}, not the ${reported} Bun reported`);
        return exact;
    } finally {
        api.CloseHandle(handle);
    }
}

/**
 * Ends this process with `code`. Bun's own process.exit cuts the code to 8
 * bits on Windows, so a relay that passes a program's exit code on would
 * lose the rest of it.
 */
export function exitWithCode(code: number): never {
    if (bunOnWindows()) (kernel32 ??= openKernel32()).symbols.ExitProcess(code);
    return process.exit(code);
}
