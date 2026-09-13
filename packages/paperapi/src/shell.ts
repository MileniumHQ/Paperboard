// One-shot host shell resolution, shared by every panel that runs a
// command through the platform shell. One invariant, one implementation:
// win32 must be positively detected (never assumed), unknown hosts fall
// back to sh. Argv arrays throughout — the command string is never
// re-parsed by a shell.

export type HostPlatformName = "win32" | "darwin" | "linux";

/** Host platform without node types (panel service bundles may not know node). */
export function detectHostPlatform(): HostPlatformName {
    const p = (globalThis as { process?: { platform?: unknown } }).process?.platform;
    if (p === "win32" || p === "darwin" || p === "linux") return p;
    return "linux";
}

export interface OneShotShell {
    command: string;
    baseArgs: string[];
}

/**
 * Resolve the platform shell for one-shot commands: cmd.exe on Windows
 * (/d skips AutoRun, /s keeps the trailing string quoted exactly),
 * sh everywhere else. Append the command string to baseArgs.
 */
export function resolveOneShotShell(
    platform: string = detectHostPlatform(),
): OneShotShell {
    if (platform === "win32") {
        return { command: "cmd.exe", baseArgs: ["/d", "/s", "/c"] };
    }
    return { command: "sh", baseArgs: ["-c"] };
}
